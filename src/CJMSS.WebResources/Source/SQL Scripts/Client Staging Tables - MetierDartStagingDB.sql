-- =====================================================================
-- COMPLETE DATABASE SETUP - FULL TABLE SCRIPTS
-- Version: With Contact Migration Tables
-- Includes: Client tables + Contact tables
-- Drop and Recreate Approach
-- =====================================================================

USE master;
GO

-- =====================================================================
-- CREATE DATABASE
-- =====================================================================

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'MetierDartStagingDB')
BEGIN
    CREATE DATABASE MetierDartStagingDB;
    PRINT '✅ Database created: MetierDartStagingDB';
END
ELSE
    PRINT '✓ Database already exists: MetierDartStagingDB';
GO

USE MetierDartStagingDB;
GO

PRINT '';
PRINT '========================================';
PRINT 'COMPLETE DATABASE CREATION';
PRINT 'Client Migration + Contact Migration';
PRINT '========================================';
PRINT '';

-- =====================================================================
-- STEP 1: DROP EXISTING OBJECTS (CORRECT ORDER)
-- =====================================================================

PRINT 'Dropping existing objects...';
PRINT '';

-- Drop views first
IF OBJECT_ID('dbo.vw_Client_Validation', 'V') IS NOT NULL
BEGIN
    DROP VIEW dbo.vw_Client_Validation;
    PRINT '✓ Dropped view: vw_Client_Validation';
END

-- Drop procedures
IF OBJECT_ID('dbo.usp_UpsertClient', 'P') IS NOT NULL
BEGIN
    DROP PROCEDURE dbo.usp_UpsertClient;
    PRINT '✓ Dropped procedure: usp_UpsertClient';
END

-- Drop tables in dependency order
IF OBJECT_ID('dbo.Contact_Mapping', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.Contact_Mapping;
    PRINT '✓ Dropped table: Contact_Mapping';
END

IF OBJECT_ID('dbo.Contact_Staging', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.Contact_Staging;
    PRINT '✓ Dropped table: Contact_Staging';
END

IF OBJECT_ID('dbo.Client_Transformed', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Client_Parent')
    BEGIN
        ALTER TABLE dbo.Client_Transformed DROP CONSTRAINT FK_Client_Parent;
        PRINT '✓ Dropped FK: FK_Client_Parent';
    END
    DROP TABLE dbo.Client_Transformed;
    PRINT '✓ Dropped table: Client_Transformed';
END

IF OBJECT_ID('dbo.Client_Transformed_Staging', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.Client_Transformed_Staging;
    PRINT '✓ Dropped table: Client_Transformed_Staging';
END

IF OBJECT_ID('dbo.Client_Hierarchy_Mapping', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.Client_Hierarchy_Mapping;
    PRINT '✓ Dropped table: Client_Hierarchy_Mapping';
END

IF OBJECT_ID('dbo.Client_Transform_Errors', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.Client_Transform_Errors;
    PRINT '✓ Dropped table: Client_Transform_Errors';
END

IF OBJECT_ID('dbo.Client_Staging', 'U') IS NOT NULL
BEGIN
    DROP TABLE dbo.Client_Staging;
    PRINT '✓ Dropped table: Client_Staging';
END

PRINT '';
PRINT 'All existing objects dropped successfully.';
PRINT '';

-- =====================================================================
-- TABLE 1: CLIENT_STAGING
-- Excel data landing zone
-- =====================================================================

PRINT 'Creating Client_Staging table...';

CREATE TABLE dbo.Client_Staging (
    -- Primary Key
    seq INT PRIMARY KEY,
    
    -- Account Information
    accno NVARCHAR(50) NULL,
    name NVARCHAR(200) NULL,
    
    -- Address
    adr NVARCHAR(500) NULL,
    adr1 NVARCHAR(500) NULL,
    
    -- Contact Details
    tel1 NVARCHAR(50) NULL,
    tel2 NVARCHAR(50) NULL,
    fax NVARCHAR(50) NULL,
    contact NVARCHAR(200) NULL,
    
    -- Financial
    balance DECIMAL(18,2) NULL,
    lcred DECIMAL(18,2) NULL,
    crdlin DECIMAL(18,2) NULL,
    disc DECIMAL(5,2) NULL,
    chg BIT NULL,
    
    -- Lookup References
    cat NVARCHAR(50) NULL,
    zone INT NULL,
    salm INT NULL,
    
    -- Hierarchy Detection
    is_duplicate BIT NULL DEFAULT 0,
    duplicate_group INT NULL,
    
    -- Audit
    created_date DATETIME2 DEFAULT GETDATE(),
    
    -- Indexes
    INDEX IX_Client_Staging_Name NONCLUSTERED (name),
    INDEX IX_Client_Staging_AccNo NONCLUSTERED (accno)
);

PRINT '✅ Client_Staging created (17 columns)';
PRINT '';

-- =====================================================================
-- TABLE 2: CLIENT_HIERARCHY_MAPPING
-- =====================================================================

PRINT 'Creating Client_Hierarchy_Mapping table...';

CREATE TABLE dbo.Client_Hierarchy_Mapping (
    mapping_id INT IDENTITY(1,1) PRIMARY KEY,
    source_seq INT NOT NULL,
    customer_name NVARCHAR(200) NOT NULL,
    record_type NVARCHAR(20) NOT NULL CHECK (record_type IN (N'MASTER', N'CHILD', N'SINGLE')),
    parent_seq INT NULL,
    master_seq INT NULL,
    pdg_legacyid NVARCHAR(50) NOT NULL UNIQUE,
    accountnumber NVARCHAR(50) NULL,
    child_count INT DEFAULT 0,
    created_date DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_Hierarchy_Staging FOREIGN KEY (source_seq) 
        REFERENCES dbo.Client_Staging(seq),
    
    INDEX IX_Hierarchy_RecordType NONCLUSTERED (record_type),
    INDEX IX_Hierarchy_ParentSeq NONCLUSTERED (parent_seq),
    INDEX IX_Hierarchy_MasterSeq NONCLUSTERED (master_seq),
    INDEX IX_Hierarchy_LegacyId NONCLUSTERED (pdg_legacyid)
);

PRINT '✅ Client_Hierarchy_Mapping created (10 columns)';
PRINT '';

-- =====================================================================
-- TABLE 3: CLIENT_TRANSFORM_ERRORS
-- =====================================================================

PRINT 'Creating Client_Transform_Errors table...';

CREATE TABLE dbo.Client_Transform_Errors (
    error_id INT IDENTITY(1,1) PRIMARY KEY,
    seq INT NULL,
    error_type NVARCHAR(50) NULL,
    error_message NVARCHAR(4000) NULL,
    error_date DATETIME2 DEFAULT GETDATE(),
    
    INDEX IX_Errors_Seq NONCLUSTERED (seq),
    INDEX IX_Errors_Type NONCLUSTERED (error_type)
);

PRINT '✅ Client_Transform_Errors created (5 columns)';
PRINT '';

-- =====================================================================
-- TABLE 4: CLIENT_TRANSFORMED_STAGING
-- =====================================================================

PRINT 'Creating Client_Transformed_Staging table...';

CREATE TABLE dbo.Client_Transformed_Staging (
    -- Primary Key
    seq INT PRIMARY KEY,
    
    -- Identifiers
    pdg_legacyid NVARCHAR(50) NOT NULL UNIQUE,
    accountnumber NVARCHAR(50) NULL,
    name NVARCHAR(200) NOT NULL,
    description NVARCHAR(4000) NULL,
    
    -- Address (Complete)
    address1_line1 NVARCHAR(500) NULL,
    address1_line2 NVARCHAR(500) NULL,
    address1_city NVARCHAR(100) NULL,
    address1_stateorprovince NVARCHAR(50) NULL,
    address1_postalcode NVARCHAR(20) NULL,
    address1_country NVARCHAR(100) NULL,
    
    -- Contact Information
    telephone1 NVARCHAR(50) NULL,
    telephone2 NVARCHAR(50) NULL,
    fax NVARCHAR(50) NULL,
    emailaddress1 NVARCHAR(200) NULL,
    websiteurl NVARCHAR(200) NULL,
    
    -- Financial Fields
    pdg_openingbalance DECIMAL(18,2) NULL,
    pdg_creditlimit DECIMAL(18,2) NULL,
    pdg_discount DECIMAL(5,2) NULL,
    pdg_allowcredit BIT NULL DEFAULT 1,
    pdg_paymenttermsdays INT NULL,
    
    -- Hierarchy Flags
    is_master BIT NOT NULL DEFAULT 0,
    is_child BIT NOT NULL DEFAULT 0,
    is_single BIT NOT NULL DEFAULT 0,
    
    -- Parent Relationship
    parent_seq INT NULL,
    pdg_parentlegacyid NVARCHAR(50) NULL,
    
    -- Lookup String Fields
    pdg_category NVARCHAR(50) NULL,
    pdg_zoneidstring NVARCHAR(50) NULL,
    pdg_salesmanidstring NVARCHAR(50) NULL,
    pdg_primarycontactname NVARCHAR(200) NULL,
    
    -- Data Quality Flags
    needs_address BIT DEFAULT 0,
    needs_email BIT DEFAULT 0,
    needs_phone BIT DEFAULT 0,
    
    -- Source Reference
    source_seq INT NOT NULL,
    
    -- Audit
    created_date DATETIME2 DEFAULT GETDATE(),
    modified_date DATETIME2 DEFAULT GETDATE(),
    
    -- Indexes
    INDEX IX_Staging_LegacyId NONCLUSTERED (pdg_legacyid),
    INDEX IX_Staging_ParentSeq NONCLUSTERED (parent_seq),
    INDEX IX_Staging_RecordType NONCLUSTERED (is_master, is_child, is_single)
);

PRINT '✅ Client_Transformed_Staging created (37 columns)';
PRINT '';

-- =====================================================================
-- TABLE 5: CLIENT_TRANSFORMED (FINAL)
-- Production-ready with computed hierarchy type
-- =====================================================================

PRINT 'Creating Client_Transformed table...';

CREATE TABLE dbo.Client_Transformed (
    -- Primary Key
    seq INT PRIMARY KEY,
    
    -- Identifiers
    pdg_legacyid NVARCHAR(50) NOT NULL UNIQUE,
    accountnumber NVARCHAR(50) NULL,
    name NVARCHAR(200) NOT NULL,
    description NVARCHAR(4000) NULL,
    
    -- Address (Complete)
    address1_line1 NVARCHAR(500) NULL,
    address1_line2 NVARCHAR(500) NULL,
    address1_city NVARCHAR(100) NULL,
    address1_stateorprovince NVARCHAR(50) NULL,
    address1_postalcode NVARCHAR(20) NULL,
    address1_country NVARCHAR(100) NULL,
    
    -- Contact Information (Enhanced)
    telephone1 NVARCHAR(50) NULL,
    telephone2 NVARCHAR(50) NULL,
    fax NVARCHAR(50) NULL,
    emailaddress1 NVARCHAR(200) NULL,
    websiteurl NVARCHAR(200) NULL,
    
    -- Financial Fields
    pdg_openingbalance DECIMAL(18,2) NULL,
    pdg_creditlimit DECIMAL(18,2) NULL,
    pdg_discount DECIMAL(5,2) NULL,
    pdg_allowcredit BIT NOT NULL DEFAULT 1,
    pdg_paymenttermsdays INT NULL,
    
    -- Hierarchy Flags
    is_master BIT NOT NULL DEFAULT 0,
    is_child BIT NOT NULL DEFAULT 0,
    is_single BIT NOT NULL DEFAULT 0,
    
    -- ⭐ COMPUTED COLUMN - Hierarchy Type
    pdg_hierarchytype AS (
        CASE 
            WHEN is_single = 1 THEN 100100000
            WHEN is_master = 1 THEN 100100001
            WHEN is_child = 1 THEN 100100002
            ELSE 100100000
        END
    ) PERSISTED,
    
    -- Parent Relationship
    parent_seq INT NULL,
    pdg_parentlegacyid NVARCHAR(50) NULL,
    
    -- Lookup String Fields
    pdg_category NVARCHAR(50) NULL,
    pdg_zoneidstring NVARCHAR(50) NULL,
    pdg_salesmanidstring NVARCHAR(50) NULL,
    pdg_primarycontactname NVARCHAR(200) NULL,
    
    -- Data Quality Flags
    needs_address BIT DEFAULT 0,
    needs_email BIT DEFAULT 0,
    needs_phone BIT DEFAULT 0,
    
    -- Source Reference
    source_seq INT NOT NULL UNIQUE,
    
    -- Audit
    created_date DATETIME2 DEFAULT GETDATE(),
    modified_date DATETIME2 DEFAULT GETDATE(),
    
    -- Indexes
    INDEX IX_Transformed_LegacyId NONCLUSTERED (pdg_legacyid),
    INDEX IX_Transformed_ParentSeq NONCLUSTERED (parent_seq),
    INDEX IX_Transformed_HierarchyType NONCLUSTERED (pdg_hierarchytype),
    INDEX IX_Transformed_RecordType NONCLUSTERED (is_master, is_child, is_single),
    INDEX IX_Transformed_Category NONCLUSTERED (pdg_category),
    INDEX IX_Transformed_Zone NONCLUSTERED (pdg_zoneidstring),
    INDEX IX_Transformed_Salesman NONCLUSTERED (pdg_salesmanidstring),
    INDEX IX_Transformed_Contact NONCLUSTERED (pdg_primarycontactname)
);

PRINT '✅ Client_Transformed created (38 columns including computed)';
PRINT '';

-- Add self-referencing FK
PRINT 'Adding self-referencing foreign key constraint...';
ALTER TABLE dbo.Client_Transformed
    ADD CONSTRAINT FK_Client_Parent FOREIGN KEY (parent_seq) 
        REFERENCES dbo.Client_Transformed(seq);
PRINT '✅ FK_Client_Parent constraint added';
PRINT '';

-- =====================================================================
-- TABLE 6: CONTACT_STAGING
-- Unique contacts extracted from Client_Transformed
-- =====================================================================

PRINT 'Creating Contact_Staging table...';

CREATE TABLE dbo.Contact_Staging (
    contact_id INT IDENTITY(1,1) PRIMARY KEY,
    
    -- Original Data
    fullname NVARCHAR(200) NOT NULL UNIQUE,
    
    -- Parsed Names
    firstname NVARCHAR(100) NULL,
    lastname NVARCHAR(100) NULL,
    
    -- Associated Account Info (for parent customer)
    primary_account_seq INT NULL,
    primary_account_name NVARCHAR(200) NULL,
    
    -- Sample Contact Info (from first account with this contact)
    sample_phone NVARCHAR(50) NULL,
    sample_email NVARCHAR(200) NULL,
    
    -- Statistics
    account_count INT DEFAULT 0,
    
    -- Quality Flags
    is_single_word BIT DEFAULT 0,
    needs_review BIT DEFAULT 0,
    
    -- Audit
    created_date DATETIME2 DEFAULT GETDATE(),
    
    INDEX IX_Contact_Fullname NONCLUSTERED (fullname),
    INDEX IX_Contact_PrimaryAccount NONCLUSTERED (primary_account_seq),
    INDEX IX_Contact_NeedsReview NONCLUSTERED (needs_review)
);

PRINT '✅ Contact_Staging created (12 columns)';
PRINT '';

-- =====================================================================
-- TABLE 7: CONTACT_MAPPING
-- Maps contact names to Dataverse Contact IDs
-- =====================================================================

PRINT 'Creating Contact_Mapping table...';

CREATE TABLE dbo.Contact_Mapping (
    mapping_id INT IDENTITY(1,1) PRIMARY KEY,
    
    -- Source
    contact_staging_id INT NOT NULL,
    fullname NVARCHAR(200) NOT NULL UNIQUE,
    
    -- Dataverse Contact ID (GUID)
    contactid UNIQUEIDENTIFIER NULL,
    
    -- Alternate Key (for lookup)
    pdg_contactlegacyid NVARCHAR(50) NULL UNIQUE,
    
    -- Status
    created_in_dataverse BIT DEFAULT 0,
    error_message NVARCHAR(4000) NULL,
    
    -- Audit
    created_date DATETIME2 DEFAULT GETDATE(),
    dataverse_created_date DATETIME2 NULL,
    
    CONSTRAINT FK_ContactMapping_Staging FOREIGN KEY (contact_staging_id) 
        REFERENCES dbo.Contact_Staging(contact_id),
    
    INDEX IX_ContactMapping_Fullname NONCLUSTERED (fullname),
    INDEX IX_ContactMapping_ContactId NONCLUSTERED (contactid),
    INDEX IX_ContactMapping_LegacyId NONCLUSTERED (pdg_contactlegacyid),
    INDEX IX_ContactMapping_Created NONCLUSTERED (created_in_dataverse)
);

PRINT '✅ Contact_Mapping created (9 columns)';
PRINT '';

-- =====================================================================
-- VIEW: VW_CLIENT_VALIDATION
-- =====================================================================

PRINT 'Creating vw_Client_Validation view...';
GO

CREATE VIEW dbo.vw_Client_Validation
AS
SELECT 
    -- Record Counts
    (SELECT COUNT(*) FROM Client_Transformed) as total_records,
    (SELECT COUNT(*) FROM Client_Transformed WHERE is_master = 1) as master_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE is_child = 1) as child_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE is_single = 1) as single_count,
    
    -- Hierarchy Type Distribution
    (SELECT COUNT(*) FROM Client_Transformed WHERE pdg_hierarchytype = 100100000) as single_type_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE pdg_hierarchytype = 100100001) as master_type_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE pdg_hierarchytype = 100100002) as child_type_count,
    
    -- Orphan Check
    (SELECT COUNT(*) FROM Client_Transformed WHERE is_child = 1 AND parent_seq IS NULL) as orphaned_children,
    
    -- Data Quality
    (SELECT COUNT(*) FROM Client_Transformed WHERE needs_address = 1) as missing_address_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE emailaddress1 IS NULL OR emailaddress1 = '') as missing_email_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE telephone1 IS NULL OR telephone1 = '') as missing_phone_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE needs_email = 1) as needs_email_count,
    (SELECT COUNT(*) FROM Client_Transformed WHERE needs_phone = 1) as needs_phone_count,
    
    -- Financial Summary
    (SELECT SUM(pdg_openingbalance) FROM Client_Transformed) as total_opening_balance,
    (SELECT SUM(pdg_creditlimit) FROM Client_Transformed) as total_credit_limit,
    (SELECT AVG(pdg_discount) FROM Client_Transformed WHERE pdg_discount IS NOT NULL) as avg_discount,
    
    -- Credit Management
    (SELECT COUNT(*) FROM Client_Transformed WHERE pdg_allowcredit = 0) as accounts_credit_denied,
    (SELECT COUNT(*) FROM Client_Transformed WHERE pdg_allowcredit = 1) as accounts_credit_allowed,
    (SELECT COUNT(*) FROM Client_Transformed WHERE pdg_paymenttermsdays IS NOT NULL) as accounts_with_terms,
    
    -- Contact Information
    (SELECT COUNT(*) FROM Client_Transformed WHERE pdg_primarycontactname IS NOT NULL) as accounts_with_contact,
    
    -- Contact Migration
    (SELECT COUNT(*) FROM Contact_Staging) as unique_contacts,
    (SELECT COUNT(*) FROM Contact_Mapping WHERE created_in_dataverse = 1) as contacts_created_dataverse,
    (SELECT COUNT(*) FROM Contact_Staging WHERE needs_review = 1) as contacts_need_review,
    
    -- Address Completeness
    (SELECT COUNT(*) FROM Client_Transformed WHERE address1_city IS NOT NULL) as with_city,
    (SELECT COUNT(*) FROM Client_Transformed WHERE address1_stateorprovince IS NOT NULL) as with_state,
    (SELECT COUNT(*) FROM Client_Transformed WHERE address1_postalcode IS NOT NULL) as with_postal,
    (SELECT COUNT(*) FROM Client_Transformed WHERE address1_country IS NOT NULL) as with_country,
    (SELECT COUNT(*) FROM Client_Transformed WHERE websiteurl IS NOT NULL) as with_website;
GO

PRINT '✅ vw_Client_Validation created';
PRINT '';

-- =====================================================================
-- STORED PROCEDURE: USP_UPSERTCLIENT
-- =====================================================================

PRINT 'Creating usp_UpsertClient procedure...';
GO

CREATE PROCEDURE dbo.usp_UpsertClient
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @inserted_count INT = 0;
    DECLARE @updated_count INT = 0;
    
    BEGIN TRY
        BEGIN TRANSACTION;
        
        MERGE INTO dbo.Client_Transformed AS target
        USING dbo.Client_Transformed_Staging AS source
        ON target.seq = source.seq
        
        WHEN MATCHED THEN
            UPDATE SET
                target.pdg_legacyid = source.pdg_legacyid,
                target.accountnumber = source.accountnumber,
                target.name = source.name,
                target.description = source.description,
                target.address1_line1 = source.address1_line1,
                target.address1_line2 = source.address1_line2,
                target.address1_city = source.address1_city,
                target.address1_stateorprovince = source.address1_stateorprovince,
                target.address1_postalcode = source.address1_postalcode,
                target.address1_country = source.address1_country,
                target.telephone1 = source.telephone1,
                target.telephone2 = source.telephone2,
                target.fax = source.fax,
                target.emailaddress1 = source.emailaddress1,
                target.websiteurl = source.websiteurl,
                target.pdg_openingbalance = source.pdg_openingbalance,
                target.pdg_creditlimit = source.pdg_creditlimit,
                target.pdg_discount = source.pdg_discount,
                target.pdg_allowcredit = source.pdg_allowcredit,
                target.pdg_paymenttermsdays = source.pdg_paymenttermsdays,
                target.is_master = source.is_master,
                target.is_child = source.is_child,
                target.is_single = source.is_single,
                target.parent_seq = source.parent_seq,
                target.pdg_parentlegacyid = source.pdg_parentlegacyid,
                target.pdg_category = source.pdg_category,
                target.pdg_zoneidstring = source.pdg_zoneidstring,
                target.pdg_salesmanidstring = source.pdg_salesmanidstring,
                target.pdg_primarycontactname = source.pdg_primarycontactname,
                target.needs_address = source.needs_address,
                target.needs_email = source.needs_email,
                target.needs_phone = source.needs_phone,
                target.source_seq = source.source_seq,
                target.modified_date = GETDATE()
        
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (
                seq, pdg_legacyid, accountnumber, name, description,
                address1_line1, address1_line2,
                address1_city, address1_stateorprovince, address1_postalcode, address1_country,
                telephone1, telephone2, fax, emailaddress1, websiteurl,
                pdg_openingbalance, pdg_creditlimit,
                pdg_discount, pdg_allowcredit, pdg_paymenttermsdays,
                is_master, is_child, is_single,
                parent_seq, pdg_parentlegacyid,
                pdg_category, pdg_zoneidstring, pdg_salesmanidstring,
                pdg_primarycontactname,
                needs_address, needs_email, needs_phone,
                source_seq, created_date, modified_date
            )
            VALUES (
                source.seq, source.pdg_legacyid, source.accountnumber, source.name, source.description,
                source.address1_line1, source.address1_line2,
                source.address1_city, source.address1_stateorprovince, source.address1_postalcode, source.address1_country,
                source.telephone1, source.telephone2, source.fax, source.emailaddress1, source.websiteurl,
                source.pdg_openingbalance, source.pdg_creditlimit,
                source.pdg_discount, source.pdg_allowcredit, source.pdg_paymenttermsdays,
                source.is_master, source.is_child, source.is_single,
                source.parent_seq, source.pdg_parentlegacyid,
                source.pdg_category, source.pdg_zoneidstring, source.pdg_salesmanidstring,
                source.pdg_primarycontactname,
                source.needs_address, source.needs_email, source.needs_phone,
                source.source_seq, GETDATE(), GETDATE()
            );
        
        SELECT @inserted_count = COUNT(*) FROM Client_Transformed_Staging s
        WHERE NOT EXISTS (SELECT 1 FROM Client_Transformed t WHERE t.seq = s.seq);
        
        SELECT @updated_count = COUNT(*) FROM Client_Transformed_Staging s
        WHERE EXISTS (SELECT 1 FROM Client_Transformed t WHERE t.seq = s.seq);
        
        COMMIT TRANSACTION;
        
        SELECT 
            @inserted_count as InsertedRecords,
            @updated_count as UpdatedRecords,
            @inserted_count + @updated_count as TotalProcessed;
            
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

PRINT '✅ usp_UpsertClient created';
PRINT '';

-- =====================================================================
-- VERIFICATION
-- =====================================================================

PRINT '========================================';
PRINT 'VERIFICATION';
PRINT '========================================';
PRINT '';

SELECT 
    'Tables' as ObjectType,
    TABLE_NAME as ObjectName,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c 
     WHERE c.TABLE_NAME = t.TABLE_NAME) as ColumnCount
FROM INFORMATION_SCHEMA.TABLES t
WHERE TABLE_TYPE = 'BASE TABLE'
  AND TABLE_SCHEMA = 'dbo'
ORDER BY TABLE_NAME;

PRINT '';
PRINT '========================================';
PRINT '✅ DATABASE SETUP COMPLETE!';
PRINT '========================================';
PRINT '';
PRINT 'Objects Created:';
PRINT '  ✓ 7 Tables (5 Client + 2 Contact)';
PRINT '  ✓ 1 View';
PRINT '  ✓ 1 Stored Procedure';
PRINT '';
PRINT 'Client Tables:';
PRINT '  1. Client_Staging (17 columns)';
PRINT '  2. Client_Hierarchy_Mapping (10 columns)';
PRINT '  3. Client_Transform_Errors (5 columns)';
PRINT '  4. Client_Transformed_Staging (37 columns)';
PRINT '  5. Client_Transformed (38 columns with computed)';
PRINT '';
PRINT 'Contact Tables:';
PRINT '  6. Contact_Staging (12 columns)';
PRINT '  7. Contact_Mapping (9 columns)';
PRINT '';
PRINT 'Fields Summary:';
PRINT '  Address:';
PRINT '    ✓ address1_city, address1_stateorprovince';
PRINT '    ✓ address1_postalcode, address1_country';
PRINT '  Contact:';
PRINT '    ✓ websiteurl, pdg_primarycontactname';
PRINT '  Financial:';
PRINT '    ✓ pdg_discount, pdg_allowcredit, pdg_paymenttermsdays';
PRINT '  Lookup:';
PRINT '    ✓ pdg_salesmanidstring, pdg_zoneidstring';
PRINT '  Data Quality:';
PRINT '    ✓ needs_email, needs_phone, needs_address';
PRINT '  Contact Migration:';
PRINT '    ✓ Contact_Staging (unique contacts)';
PRINT '    ✓ Contact_Mapping (Dataverse GUIDs)';
PRINT '';
PRINT 'Features:';
PRINT '  ✓ Natural key design (seq as PK)';
PRINT '  ✓ Computed pdg_hierarchytype';
PRINT '  ✓ Complete address structure';
PRINT '  ✓ Data quality tracking';
PRINT '  ✓ Contact extraction and mapping';
PRINT '  ✓ Self-referencing parent-child FK';
PRINT '  ✓ Idempotent UPSERT capability';
PRINT '';
PRINT 'Ready for:';
PRINT '  1. Excel data import (12,061 records)';
PRINT '  2. Hierarchy mapping';
PRINT '  3. SSIS transformation';
PRINT '  4. Contact extraction (~9,000 unique)';
PRINT '  5. Contact creation in Dataverse';
PRINT '  6. Account migration with Contact links';
PRINT '';

GO

/*
=======================================================================
COMPLETE DATABASE SCHEMA SUMMARY
=======================================================================

TOTAL TABLES: 7
───────────────

CLIENT TABLES (5):
1. Client_Staging (17 columns)
   - Excel landing zone
   - Includes: disc, chg, salm, contact

2. Client_Hierarchy_Mapping (10 columns)
   - MASTER/CHILD/SINGLE classification
   - Natural key design

3. Client_Transform_Errors (5 columns)
   - Error logging

4. Client_Transformed_Staging (37 columns)
   - MERGE staging area
   - All fields including new ones

5. Client_Transformed (38 columns)
   - Production table
   - Computed pdg_hierarchytype

CONTACT TABLES (2):
6. Contact_Staging (12 columns)
   - Unique contacts extracted from clients
   - Name parsing (first/last)
   - Quality flags
   - Statistics (account count)

7. Contact_Mapping (9 columns)
   - Maps contact names to Dataverse GUIDs
   - Alternate key storage
   - Status tracking

=======================================================================
FIELD CHANGES FROM PREVIOUS VERSION
=======================================================================

RENAMED:
- pdg_creditonhold → pdg_allowcredit (positive framing)

ADDED:
- Contact_Staging table (12 columns)
- Contact_Mapping table (9 columns)
- Index on pdg_primarycontactname in Client_Transformed

=======================================================================
CONTACT MIGRATION WORKFLOW
=======================================================================

1. Extract Unique Contacts:
   Client_Transformed → Contact_Staging
   - SELECT DISTINCT pdg_primarycontactname
   - Parse into firstname/lastname
   - Create legacy IDs (CONTACT-00001, etc.)

2. Map Contacts:
   Contact_Staging → Contact_Mapping
   - Store alternate keys
   - Ready for Dataverse creation

3. Create in Dataverse:
   Contact_Mapping → Dataverse Contact entity
   - Update contactid (GUID) in mapping table

4. Link Accounts:
   Client_Transformed + Contact_Mapping → Dataverse Account
   - Use alternate key lookup
   - Populate primarycontactid

=======================================================================
*/