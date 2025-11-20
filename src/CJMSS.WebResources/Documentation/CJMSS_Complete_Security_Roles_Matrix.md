# CJMSS Complete Security Roles Matrix - All Tables

## Overview

This document provides the complete security role permissions matrix for all entities in the CJMSS (Complete Jewelry Manufacturing System) Dataverse solution.

**Permission Levels:**
- **Organization (Org)**: Access to all records across the entire organization
- **Business Unit (BU)**: Access to records within user's business unit and child business units
- **User**: Access only to records owned by the user
- **None**: No access to the entity

**Permission Types:**
- **Create**: Create new records
- **Read**: View records
- **Write**: Edit existing records
- **Delete**: Delete records
- **Append**: Associate records to this entity
- **Append To**: Associate this entity to other records
- **Assign**: Change record owner
- **Share**: Share records with other users

---

## Security Roles

1. **CJMSS System Administrator** - Full system access
2. **CJMSS Production Manager** - Production and manufacturing operations
3. **CJMSS Inventory Manager** - Inventory and warehouse management
4. **CJMSS Purchasing Manager** - Procurement and supplier management
5. **CJMSS Sales Manager** - Sales operations (future module)
6. **CJMSS Read Only** - View-only access across the system

---

## 1. CJMSS SYSTEM ADMINISTRATOR

**Scope:** Organization-wide full administrative access

| Entity | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|--------|--------|------|-------|--------|--------|-----------|--------|-------|
| **INVENTORY MANAGEMENT** |
| pdg_inventory | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_inventoryitem | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_inventorytransaction | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_stockmovement | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_transferrequest | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_transferrequestline | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_physicalcount | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_physicalcountline | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_cyclecountschedule | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_reservationdetail | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_serialnumber | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_lotnumber | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_barcode | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_binhistory | Org | Org | Org | Org | Org | Org | Org | Org |
| **WAREHOUSE & LOCATION** |
| pdg_warehouse | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_bin | Org | Org | Org | Org | Org | Org | Org | Org |
| **PRODUCTION** |
| pdg_productionsheet | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_consumption | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_alloysheet | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_worksheet | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_workorder | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_billofmaterials | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_qualitycontrol | Org | Org | Org | Org | Org | Org | Org | Org |
| **PROCUREMENT** |
| pdg_purchaseorder | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_purchaseorderline | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_purchaseorderreceipt | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_purchaseorderchange | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_shippingcharges | Org | Org | Org | Org | Org | Org | Org | Org |
| **PLANNING** |
| pdg_reorderpoint | Org | Org | Org | Org | Org | Org | Org | Org |
| **MASTER DATA** |
| pdg_itemcategory | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_unitofmeasure | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_currency | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_documentnumbering | Org | Org | Org | Org | Org | Org | Org | Org |
| pdg_systemconfiguration | Org | Org | Org | Org | Org | Org | Org | Org |
| account (Suppliers/Customers) | Org | Org | Org | BU | Org | Org | Org | Org |
| contact | Org | Org | Org | BU | Org | Org | Org | Org |

---

## 2. CJMSS PRODUCTION MANAGER

**Scope:** Business Unit for write operations, Organization for read

| Entity | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|--------|--------|------|-------|--------|--------|-----------|--------|-------|
| **PRODUCTION** (Full Access) |
| pdg_productionsheet | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_consumption | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_alloysheet | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_worksheet | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_workorder | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_billofmaterials | BU | Org | BU | None | BU | Org | None | BU |
| pdg_qualitycontrol | BU | Org | BU | BU | BU | Org | BU | BU |
| **INVENTORY** (Read + Append) |
| pdg_inventory | None | Org | None | None | BU | Org | None | None |
| pdg_inventoryitem | None | Org | None | None | BU | Org | None | None |
| pdg_inventorytransaction | BU | Org | None | None | BU | Org | None | None |
| pdg_stockmovement | BU | Org | None | None | BU | Org | None | None |
| pdg_serialnumber | None | Org | None | None | BU | Org | None | None |
| pdg_lotnumber | None | Org | None | None | BU | Org | None | None |
| **WAREHOUSE** (Read Only) |
| pdg_warehouse | None | Org | None | None | None | Org | None | None |
| pdg_bin | None | Org | None | None | None | Org | None | None |
| **PROCUREMENT** (Read Only) |
| pdg_purchaseorder | None | Org | None | None | None | Org | None | None |
| pdg_purchaseorderline | None | Org | None | None | None | Org | None | None |
| pdg_purchaseorderreceipt | None | Org | None | None | None | Org | None | None |
| **PLANNING** (Read Only) |
| pdg_reorderpoint | None | Org | None | None | None | Org | None | None |
| **MASTER DATA** (Read Only) |
| pdg_itemcategory | None | Org | None | None | None | Org | None | None |
| pdg_unitofmeasure | None | Org | None | None | None | Org | None | None |
| account | None | Org | None | None | None | Org | None | None |

---

## 3. CJMSS INVENTORY MANAGER

**Scope:** Business Unit for write operations, Organization for read

| Entity | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|--------|--------|------|-------|--------|--------|-----------|--------|-------|
| **INVENTORY** (Full Access) |
| pdg_inventory | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_inventoryitem | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_inventorytransaction | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_stockmovement | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_transferrequest | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_transferrequestline | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_physicalcount | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_physicalcountline | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_cyclecountschedule | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_serialnumber | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_lotnumber | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_barcode | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_reservationdetail | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_binhistory | BU | Org | BU | BU | BU | Org | BU | BU |
| **WAREHOUSE** (Full Access) |
| pdg_warehouse | BU | Org | BU | None | BU | Org | BU | BU |
| pdg_bin | BU | Org | BU | BU | BU | Org | BU | BU |
| **PLANNING** (Full Access) |
| pdg_reorderpoint | BU | Org | BU | BU | BU | Org | BU | BU |
| **PRODUCTION** (Read Only) |
| pdg_productionsheet | None | Org | None | None | None | Org | None | None |
| pdg_consumption | None | Org | None | None | None | Org | None | None |
| pdg_alloysheet | None | Org | None | None | None | Org | None | None |
| pdg_worksheet | None | Org | None | None | None | Org | None | None |
| pdg_workorder | None | Org | None | None | None | Org | None | None |
| pdg_billofmaterials | None | Org | None | None | None | Org | None | None |
| **PROCUREMENT** (Read Only) |
| pdg_purchaseorder | None | Org | None | None | None | Org | None | None |
| pdg_purchaseorderline | None | Org | None | None | None | Org | None | None |
| pdg_purchaseorderreceipt | None | Org | None | None | None | Org | None | None |
| **MASTER DATA** (Append Access) |
| pdg_itemcategory | BU | Org | BU | None | BU | Org | None | BU |
| pdg_unitofmeasure | BU | Org | BU | None | BU | Org | None | BU |
| account | None | Org | None | None | BU | Org | None | None |

---

## 4. CJMSS PURCHASING MANAGER

**Scope:** Business Unit for write operations, Organization for read

| Entity | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|--------|--------|------|-------|--------|--------|-----------|--------|-------|
| **PROCUREMENT** (Full Access) |
| pdg_purchaseorder | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_purchaseorderline | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_purchaseorderreceipt | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_purchaseorderchange | BU | Org | BU | None | BU | Org | None | BU |
| pdg_shippingcharges | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_qualitycontrol | BU | Org | BU | BU | BU | Org | BU | BU |
| **SUPPLIERS** (Full Access) |
| account (Suppliers) | BU | Org | BU | None | BU | Org | BU | BU |
| contact | BU | Org | BU | None | BU | Org | BU | BU |
| **PLANNING** (Full Access) |
| pdg_reorderpoint | BU | Org | BU | BU | BU | Org | BU | BU |
| **INVENTORY** (Read + Append) |
| pdg_inventory | None | Org | None | None | BU | Org | None | None |
| pdg_inventoryitem | BU | Org | BU | None | BU | Org | None | BU |
| pdg_inventorytransaction | None | Org | None | None | None | Org | None | None |
| pdg_stockmovement | None | Org | None | None | None | Org | None | None |
| pdg_serialnumber | None | Org | None | None | BU | Org | None | None |
| pdg_lotnumber | None | Org | None | None | BU | Org | None | None |
| **WAREHOUSE** (Read Only) |
| pdg_warehouse | None | Org | None | None | None | Org | None | None |
| pdg_bin | None | Org | None | None | None | Org | None | None |
| **PRODUCTION** (Read Only) |
| pdg_productionsheet | None | Org | None | None | None | Org | None | None |
| pdg_consumption | None | Org | None | None | None | Org | None | None |
| pdg_alloysheet | None | Org | None | None | None | Org | None | None |
| pdg_worksheet | None | Org | None | None | None | Org | None | None |
| pdg_workorder | None | Org | None | None | None | Org | None | None |
| **MASTER DATA** (Append Access) |
| pdg_itemcategory | BU | Org | BU | None | BU | Org | None | BU |
| pdg_unitofmeasure | BU | Org | BU | None | BU | Org | None | BU |

---

## 5. CJMSS SALES MANAGER (Future Module)

**Scope:** Business Unit for write operations, Organization for read

| Entity | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|--------|--------|------|-------|--------|--------|-----------|--------|-------|
| **SALES** (Full Access - When Created) |
| pdg_salesorder | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_salesorderline | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_invoice | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_invoiceline | BU | Org | BU | BU | BU | Org | BU | BU |
| **CUSTOMERS** (Full Access) |
| account (Customers) | BU | Org | BU | None | BU | Org | BU | BU |
| contact | BU | Org | BU | None | BU | Org | BU | BU |
| **INVENTORY** (Read + Reservations) |
| pdg_inventory | None | Org | None | None | None | Org | None | None |
| pdg_inventoryitem | None | Org | None | None | BU | Org | None | None |
| pdg_reservationdetail | BU | Org | BU | BU | BU | Org | BU | BU |
| pdg_serialnumber | None | Org | None | None | BU | Org | None | None |
| **WAREHOUSE** (Read Only) |
| pdg_warehouse | None | Org | None | None | None | Org | None | None |
| pdg_bin | None | Org | None | None | None | Org | None | None |
| **PRODUCTION** (Read Only) |
| All Production Entities | None | Org | None | None | None | Org | None | None |
| **PROCUREMENT** (Read Only) |
| All Procurement Entities | None | Org | None | None | None | Org | None | None |
| **MASTER DATA** (Read Only) |
| All Master Data | None | Org | None | None | None | Org | None | None |

---

## 6. CJMSS READ ONLY

**Scope:** Organization-wide read access only

| Entity | Create | Read | Write | Delete | Append | Append To | Assign | Share |
|--------|--------|------|-------|--------|--------|-----------|--------|-------|
| **ALL ENTITIES** | None | Org | None | None | None | None | None | None |

**Note:** This role provides view-only access to all CJMSS entities across the organization. No create, modify, or delete permissions.

---

## Field-Level Security (FLS)

### Sensitive Fields Requiring FLS:

| Field | Table | Restricted To |
|-------|-------|---------------|
| pdg_costprice | pdg_inventoryitem | System Admin, Inventory Manager |
| pdg_averagecost | pdg_inventoryitem | System Admin, Inventory Manager |
| pdg_lastpurchaseprice | pdg_inventoryitem | System Admin, Purchasing Manager |
| pdg_standardcost | pdg_inventoryitem | System Admin, Inventory Manager |
| pdg_cogp | pdg_productionsheet | System Admin, Production Manager |
| pdg_unitcost | All transaction tables | System Admin, Respective Manager |
| pdg_totalamount | pdg_purchaseorder | System Admin, Purchasing Manager |
| pdg_totalcost | pdg_productionsheet | System Admin, Production Manager |
| pdg_marginpercentage | pdg_salesorder | System Admin, Sales Manager |

### FLS Profile Setup:

Create 4 Field-Level Security Profiles:

1. **CJMSS Inventory FLS** - Cost fields on Inventory Items
2. **CJMSS Production FLS** - Cost fields on Production entities
3. **CJMSS Purchasing FLS** - Pricing on Purchase Orders
4. **CJMSS Sales FLS** - Margin information on Sales

---

## Custom Actions/Processes Permissions

### Special Operations:

| Action | Allowed Roles |
|--------|---------------|
| Post Inventory Transaction | System Admin, Inventory Manager |
| Reverse Inventory Transaction | System Admin |
| Close Production Sheet | System Admin, Production Manager |
| Reopen Production Sheet | System Admin |
| Process Alloy Sheet | System Admin, Production Manager |
| Complete Physical Count | System Admin, Inventory Manager |
| Approve Purchase Order | System Admin, Purchasing Manager |
| Post Purchase Receipt | System Admin, Purchasing Manager, Inventory Manager |
| Close Purchase Order | System Admin, Purchasing Manager |
| Cancel Purchase Order | System Admin, Purchasing Manager |
| Process Work Order | System Admin, Production Manager |
| Complete Work Order | System Admin, Production Manager |

---

## Implementation Notes

### 1. Business Unit Scoping
- Most entities use **Organization** read scope to allow cross-BU visibility
- Write/Delete limited to **Business Unit** to maintain data ownership
- System Admin has full **Organization** scope on all operations

### 2. Cascading Permissions
- Parent records automatically grant access to child records
- Example: If user can read Purchase Order, they can read Purchase Order Lines

### 3. Record Ownership
- Records are owned by creating user's Business Unit
- Assign permission allows changing ownership
- Share permission allows granting access to specific users

### 4. Master Data Strategy
- Master data (Categories, Warehouses, UOM) readable by all
- Creation/modification restricted to managers and admins
- Prevents accidental changes to foundational data

### 5. Transaction Security
- Posted transactions become read-only (enforced by business rules)
- Reversal requires System Admin approval
- Audit trail maintained for all financial transactions

---

## Testing Security Matrix

### Test Scenarios by Role:

**Production Manager:**
- ✅ Can create Production Sheets
- ✅ Can create Consumptions
- ✅ Can view Inventory levels
- ❌ Cannot create Purchase Orders
- ❌ Cannot modify Warehouses
- ✅ Can transfer items between production warehouses

**Inventory Manager:**
- ✅ Can create Physical Counts
- ✅ Can create Transfer Requests
- ✅ Can modify Inventory records
- ✅ Can create/edit Items
- ❌ Cannot create Production Sheets
- ❌ Cannot create Purchase Orders

**Purchasing Manager:**
- ✅ Can create Purchase Orders
- ✅ Can create Suppliers
- ✅ Can post Purchase Receipts
- ✅ Can view Inventory levels
- ❌ Cannot create Production Sheets
- ❌ Cannot modify Physical Counts

---

## Migration Checklist

When deploying to client environment:

- [ ] Create all 6 security roles
- [ ] Configure permissions per matrix above
- [ ] Set up Field Level Security profiles
- [ ] Create test users for each role
- [ ] Execute test scenarios
- [ ] Document any client-specific modifications
- [ ] Train client administrators on role management

---

## ROLE SUMMARY TABLE

| Role | Primary Function | Key Entities | Access Level |
|------|-----------------|--------------|--------------|
| System Administrator | Full system admin | All | Organization - Full |
| Production Manager | Manufacturing operations | Production, QC, BOM | BU Write, Org Read |
| Inventory Manager | Stock & warehouse mgmt | Inventory, Warehouse, Items | BU Write, Org Read |
| Purchasing Manager | Procurement & receiving | PO, Receipts, Suppliers | BU Write, Org Read |
| Sales Manager | Sales operations | Sales Orders, Customers | BU Write, Org Read |
| Read Only | Reporting & viewing | All | Organization - Read Only |

---

**Document Version:** 2.0  
**Last Updated:** October 2025  
**Author:** CJMSS Implementation Team
**Total Entities Covered:** 37+ entities across 7 functional areas
