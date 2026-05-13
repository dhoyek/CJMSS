USE MetierDartStagingDB;
GO

-- Drop if exists
IF OBJECT_ID('dbo.ProductionSheet_Staging', 'U') IS NOT NULL
    DROP TABLE dbo.ProductionSheet_Staging;
GO

CREATE TABLE dbo.ProductionSheet_Staging (
    -- Identity
    staging_id INT IDENTITY(1,1) PRIMARY KEY,
    
    -- All 31 fields from DC_FinalMapping
    pdg_legacyid NVARCHAR(20),
    pdg_referencenumber NVARCHAR(100),
    pdg_finisheditemid NVARCHAR(100),
    pdg_clientid NVARCHAR(20),
    pdg_warehouseid NVARCHAR(50),
    pdg_operatorid NVARCHAR(10),
    transactioncurrencyid NVARCHAR(50),
    pdg_quantity INT,
    pdg_deliveredquantity INT,
    pdg_returnedquantity INT,
    pdg_deliveredreturnedquantity INT,
    pdg_isended BIT,
    pdg_isposted BIT,
    pdg_designref NVARCHAR(100),
    pdg_quotationref NVARCHAR(100),
    pdg_moldref NVARCHAR(100),
    pdg_markingref NVARCHAR(100),
    pdg_dolphincurrencycode INT,
    pdg_goldweight DECIMAL(18,3),
    pdg_totalcost DECIMAL(18,2),
    pdg_overheads DECIMAL(18,2),
    pdg_publicprice DECIMAL(18,2),
    pdg_localpricef DECIMAL(18,2),
    pdg_legacycostforeign DECIMAL(18,8),
    pdg_legacycostlbp DECIMAL(18,8),
    pdg_legacycostsecondary DECIMAL(18,8),
    pdg_legacyexportpriceforeign DECIMAL(18,8),
    pdg_legacyexportpricelbp DECIMAL(18,8),
    pdg_legacyexportpricesecondary DECIMAL(18,8),
    pdg_legacylocalpricef DECIMAL(18,8),
    pdg_legacylocalpricelbp DECIMAL(18,8),
    pdg_legacylocalpricesecondary DECIMAL(18,8),
    
    -- Raw date strings from Excel
    raw_dat NVARCHAR(50),
    raw_delivery NVARCHAR(50),
    raw_cldate NVARCHAR(50),
    raw_opdate NVARCHAR(50),
    
    -- Raw category for parsing
    raw_prdcat NVARCHAR(50),
    
    -- Parsed date columns (will be populated by SQL)
    pdg_productiondate DATE NULL,
    pdg_estimateddelivery DATE NULL,
    pdg_closeddate DATE NULL,
    pdg_operationaldate DATE NULL,
    
    -- Status columns (will be populated by SQL)
    pdg_sheetstatus INT,
    pdg_closesheetstatus INT,
    pdg_progressstatus INT,
    pdg_productioncategory INT NULL
);
GO