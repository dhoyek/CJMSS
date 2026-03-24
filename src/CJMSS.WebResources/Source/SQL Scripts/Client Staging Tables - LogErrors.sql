USE MetierDartStagingDB;
GO

CREATE TABLE dbo.Client_Load_Errors (
    error_id INT IDENTITY(1,1) PRIMARY KEY,
    seq INT NULL,
    name NVARCHAR(255) NULL,
    adr NVARCHAR(500) NULL,
    adr1 NVARCHAR(500) NULL,
    tel1 NVARCHAR(255) NULL,
    tel2 NVARCHAR(255) NULL,
    fax NVARCHAR(255) NULL,
    telex NVARCHAR(255) NULL,
    zone INT NULL,
    contact NVARCHAR(255) NULL,
    cat NVARCHAR(255) NULL,
    lcred INT NULL,
    crdlin INT NULL,
    accno FLOAT NULL,
    salm INT NULL,
    disc INT NULL,
    chg BIT NULL,
    balance DECIMAL(18,2) NULL,
    v01 INT NULL, v02 INT NULL, v03 INT NULL, v04 INT NULL,
    v05 INT NULL, v06 INT NULL, v07 INT NULL, v08 INT NULL,
    v09 INT NULL, v10 INT NULL, v11 INT NULL, v12 INT NULL,
    vly INT NULL,
    ErrorCode INT NULL,
    ErrorColumn INT NULL,
    ErrorDate DATETIME2 DEFAULT GETDATE()
);