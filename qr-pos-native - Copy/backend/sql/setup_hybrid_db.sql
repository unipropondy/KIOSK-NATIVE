-- ========================================================================
-- POS HYBRID DATABASE ARCHITECTURE - LOCAL DATABASE INITIALIZATION SCRIPT
-- Database: UCSPONDY_HYBRID
-- Purpose: Creates the Sync Queue table and essential tracking columns
-- ========================================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'UCSPONDY_HYBRID')
BEGIN
    CREATE DATABASE [UCSPONDY_HYBRID];
    PRINT '✅ Database UCSPONDY_HYBRID created successfully.';
END
ELSE
BEGIN
    PRINT 'ℹ️ Database UCSPONDY_HYBRID already exists.';
END
GO

USE [UCSPONDY_HYBRID];
GO

-- 1. Create POS_SyncQueue Table for Reliable Background Synchronization
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'POS_SyncQueue')
BEGIN
    CREATE TABLE [dbo].[POS_SyncQueue] (
        [SyncID] [bigint] IDENTITY(1,1) NOT NULL PRIMARY KEY CLUSTERED,
        [EntityName] [nvarchar](100) NOT NULL,
        [EntityID] [nvarchar](255) NOT NULL,
        [Action] [nvarchar](50) NOT NULL,
        [Payload] [nvarchar](max) NOT NULL,
        [Status] [nvarchar](50) CONSTRAINT [DF_POS_SyncQueue_Status] DEFAULT ('PENDING') NULL,
        [Retries] [int] CONSTRAINT [DF_POS_SyncQueue_Retries] DEFAULT ((0)) NULL,
        [ErrorMessage] [nvarchar](max) NULL,
        [CreatedAt] [datetime] CONSTRAINT [DF_POS_SyncQueue_CreatedAt] DEFAULT (getdate()) NULL,
        [SyncedAt] [datetime] NULL
    );
    PRINT '✅ POS_SyncQueue table created successfully.';
END
ELSE
BEGIN
    PRINT 'ℹ️ POS_SyncQueue table already exists.';
END
GO

-- 2. Create Index on Status and Retries for high performance queue polling
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_POS_SyncQueue_Status_Retries')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_POS_SyncQueue_Status_Retries] 
    ON [dbo].[POS_SyncQueue] ([Status], [Retries], [SyncID]);
    PRINT '✅ Index IX_POS_SyncQueue_Status_Retries created.';
END
GO

-- 3. Verify and ensure isUploadHQ column exists in core tables (if replicated from master)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'RestaurantOrder')
   AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('RestaurantOrder') AND name = 'isUploadHQ')
BEGIN
    ALTER TABLE [RestaurantOrder] ADD [isUploadHQ] [bit] CONSTRAINT [DF_RestaurantOrder_isUploadHQ] DEFAULT ((0)) NULL;
    PRINT '✅ Added isUploadHQ column to RestaurantOrder.';
END
GO

IF EXISTS (SELECT * FROM sys.tables WHERE name = 'RestaurantInvoice')
   AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('RestaurantInvoice') AND name = 'isUploadHQ')
BEGIN
    ALTER TABLE [RestaurantInvoice] ADD [isUploadHQ] [bit] CONSTRAINT [DF_RestaurantInvoice_isUploadHQ] DEFAULT ((0)) NULL;
    PRINT '✅ Added isUploadHQ column to RestaurantInvoice.';
END
GO

IF EXISTS (SELECT * FROM sys.tables WHERE name = 'Paymentdetail')
   AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Paymentdetail') AND name = 'isUploadHQ')
BEGIN
    ALTER TABLE [Paymentdetail] ADD [isUploadHQ] [bit] CONSTRAINT [DF_Paymentdetail_isUploadHQ] DEFAULT ((0)) NULL;
    PRINT '✅ Added isUploadHQ column to Paymentdetail.';
END
GO
