var PDG = PDG || {};
PDG.InventoryTransaction = (function(){
    // ===== COMPREHENSIVE INVENTORY TRANSACTION FORM =====
    // Features:
    // ✅ All transaction types with advanced filtering
    // ✅ Item-based warehouse filtering for From and To
    // ✅ Stock sufficiency validation with real-time feedback
    // ✅ Smart read-only inventory fields (better UX than hiding)
    // ✅ Complete inventory posting logic
    // ✅ Barcode scanning for items and inventory bins
    // ✅ Smart filtering with pre-search application
    // ✅ Comprehensive validation
    // ✅ Posted transaction locking
    // ✅ Reference type handling
    // 📋 Uses Dataverse OOB auto-numbering
    // 📷 Barcode integration for mobile/handheld scanners
    //
    // 🎯 Read-Only vs Hidden Fields Approach:
    // Using read-only fields instead of hiding provides:
    // • Predictable UI layout - users see complete form structure
    // • Better workflow clarity - shows logical sequence
    // • Enhanced accessibility - screen readers can announce all fields
    // • Professional enterprise application feel
    // • Helpful guidance through field labels and states
    
    // Option Set Constants
    const STATUS = { DRAFT: 100000000, POSTED: 100000001, CANCELLED: 100000002 };
    const TRANSACTION_TYPE = {
        RECEIPT: 100000000,     // Stock In
        ISSUE: 100000001,       // Stock Out
        TRANSFER: 100000002,    // Transfer
        ADJUSTMENT: 100000003,  // Adjustment
        COUNT: 100000004        // Physical Count
    };
    const REFERENCE_TYPE = {
        PURCHASE: 100000000,
        SALES: 100000001,
        PRODUCTION: 100000002,
        TRANSFER: 100000003,
        MANUAL: 100000004
    };

    // === Entry Point ===
    async function onLoad(executionContext){
        try {
            const formContext = executionContext.getFormContext();
            
            if (formContext.ui.getFormType() === 1) { // Create
                setDefaults(formContext);
            }

            setupEventHandlers(formContext);
            lockPostedTransactions(formContext);
            handleTransactionTypeChange({ getFormContext: () => formContext });
            
            // Load related info if item already selected (for edit mode)
            const item = formContext.getAttribute("pdg_itemid").getValue();
            if (item) {
                await loadItemInformation(formContext, item[0].id);
                await refreshAllFilters(formContext);
            }
            
            // Initial field visibility setup
            updateFieldVisibility(formContext);
        } catch (error) {
            console.error("Error in onLoad:", error);
        }
    }

    function setDefaults(formContext){
        const now = new Date();
        
        // Set default date and status
        if (!formContext.getAttribute("pdg_transactiondate").getValue())
            formContext.getAttribute("pdg_transactiondate").setValue(now);
        if (!formContext.getAttribute("pdg_transactionstatus").getValue())
            formContext.getAttribute("pdg_transactionstatus").setValue(STATUS.DRAFT);
        
        // Set default reference type
        if (!formContext.getAttribute("pdg_referencetype").getValue())
            formContext.getAttribute("pdg_referencetype").setValue(REFERENCE_TYPE.MANUAL);
    }

    function setupEventHandlers(ctx){
        ctx.getAttribute("pdg_transactiontype").addOnChange(handleTransactionTypeChange);
        ctx.getAttribute("pdg_itemid").addOnChange(handleItemChangeWithBarcode);
        ctx.getAttribute("pdg_fromwarehouseid").addOnChange(handleWarehouseChange);
        ctx.getAttribute("pdg_towarehouseid").addOnChange(handleWarehouseChange);
        ctx.getAttribute("pdg_quantity").addOnChange(handleQuantityChange);
        ctx.getAttribute("pdg_unitcost").addOnChange(calculateTotalCost);
        ctx.getAttribute("pdg_referencetype").addOnChange(handleReferenceTypeChange);
        
        // Add barcode handling
        setupBarcodeHandlers(ctx);
        
        ctx.data.entity.addOnSave(e => onSaveValidation(e, ctx));
    }

    // === Enhanced Field Management (Read-Only Approach) ===
    function updateFieldVisibility(ctx) {
        const type = ctx.getAttribute("pdg_transactiontype").getValue();
        const item = ctx.getAttribute("pdg_itemid").getValue();
        const fromWh = ctx.getAttribute("pdg_fromwarehouseid").getValue();
        const toWh = ctx.getAttribute("pdg_towarehouseid").getValue();

        // Transaction type based visibility (only hide if truly not applicable)
        const showFrom = [TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.TRANSFER, TRANSACTION_TYPE.ADJUSTMENT, TRANSACTION_TYPE.COUNT].includes(type);
        const showTo = [TRANSACTION_TYPE.RECEIPT, TRANSACTION_TYPE.TRANSFER].includes(type);
        const showReason = [TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.ADJUSTMENT].includes(type);

        toggleFieldVisibility(ctx, "pdg_fromwarehouseid", showFrom);
        toggleFieldVisibility(ctx, "pdg_towarehouseid", showTo);
        toggleFieldVisibility(ctx, "pdg_reason", showReason);

        // Inventory fields - always visible but controlled via read-only
        setInventoryFieldState(ctx, "pdg_frominventoryid", showFrom, item, fromWh, "source");
        setInventoryFieldState(ctx, "pdg_toinventoryid", showTo, item, toWh, "destination");

        // Update field labels based on transaction type
        updateFieldLabels(ctx, type);
    }

    function setInventoryFieldState(ctx, fieldName, isRequired, item, warehouse, direction) {
        const control = ctx.getControl(fieldName);
        if (!control) return;

        // Always show the field
        control.setVisible(true);
        
        if (!isRequired) {
            // Transaction type doesn't need this field
            control.setDisabled(true);
            control.setLabel(`${direction === 'source' ? 'Source' : 'Destination'} Inventory (Not applicable)`);
            return;
        }

        if (!item) {
            // No item selected yet
            control.setDisabled(true);
            control.setLabel(`${direction === 'source' ? 'Source' : 'Destination'} Inventory (Select item first)`);
            
            // Clear any previous value
            ctx.getAttribute(fieldName).setValue(null);
            
        } else if (!warehouse) {
            // Item selected but no warehouse
            control.setDisabled(true);
            control.setLabel(`${direction === 'source' ? 'Source' : 'Destination'} Inventory (Select warehouse first)`);
            
            // Clear any previous value
            ctx.getAttribute(fieldName).setValue(null);
            
        } else {
            // Both item and warehouse selected - enable the field
            control.setDisabled(false);
            control.setLabel(`${direction === 'source' ? 'Source' : 'Destination'} Inventory`);
        }
    }

    // === Transaction Status Management ===
    function lockPostedTransactions(ctx) {
        const status = ctx.getAttribute("pdg_transactionstatus").getValue();
        
        if (status === STATUS.POSTED || status === STATUS.CANCELLED) {
            const controls = ctx.ui.controls.get();
            controls.forEach(control => {
                try {
                    if (control.getControlType() !== "subgrid" && control.getName() !== "pdg_transactionstatus") {
                        control.setDisabled(true);
                    }
                } catch (e) {
                    console.warn("Could not disable control:", e);
                }
            });
            
            const statusText = status === STATUS.POSTED ? "posted" : "cancelled";
            ctx.ui.setFormNotification(
                `⚠️ This transaction has been ${statusText} and cannot be modified`,
                "WARNING",
                "transaction_locked"
            );
        }
    }

    // === Barcode Handling ===
    function setupBarcodeHandlers(ctx) {
        const barcodeControl = ctx.getControl("pdg_barcode_scan");
        if (barcodeControl) {
            ctx.getAttribute("pdg_barcode_scan").addOnChange(handleBarcodeScanned);
            barcodeControl.setLabel("📷 Scan Item Barcode");
            ctx.ui.setFormNotification(
                "💡 Tip: Use the barcode field to quickly find items by scanning or typing the barcode",
                "INFO", 
                "barcode_tip"
            );
        }
        
        const fromInvBarcodeControl = ctx.getControl("pdg_from_inventory_barcode");
        if (fromInvBarcodeControl) {
            ctx.getAttribute("pdg_from_inventory_barcode").addOnChange(handleFromInventoryBarcode);
            fromInvBarcodeControl.setLabel("📦 Scan Source Bin");
        }
        
        const toInvBarcodeControl = ctx.getControl("pdg_to_inventory_barcode");
        if (toInvBarcodeControl) {
            ctx.getAttribute("pdg_to_inventory_barcode").addOnChange(handleToInventoryBarcode);
            toInvBarcodeControl.setLabel("📦 Scan Destination Bin");
        }
    }

    async function handleBarcodeScanned(executionContext) {
        const ctx = executionContext.getFormContext();
        const barcode = ctx.getAttribute("pdg_barcode_scan").getValue();
        
        if (!barcode || barcode.trim() === '') return;
        
        try {
            ctx.ui.setFormNotification("🔍 Looking up item by barcode...", "INFO", "barcode_lookup");
            
            const result = await Xrm.WebApi.retrieveMultipleRecords("pdg_inventoryitem",
                `?$select=pdg_inventoryitemid,pdg_name,pdg_qrcode,pdg_unitcost,pdg_cogp,pdg_barcode&$filter=(pdg_barcode eq '${barcode.trim()}' or pdg_supplieritemcode eq '${barcode.trim()}') and statecode eq 0`);
            
            if (result.entities.length === 1) {
                const item = result.entities[0];
                
                ctx.getAttribute("pdg_itemid").setValue([{
                    id: item.pdg_inventoryitemid,
                    name: item.pdg_name,
                    entityType: "pdg_inventoryitem"
                }]);
                
                ctx.getAttribute("pdg_barcode_scan").setValue(null);
                
                ctx.ui.setFormNotification(
                    `✅ Item found: ${item.pdg_name} (${item.pdg_qrcode})`,
                    "INFO",
                    "barcode_success"
                );
                
                await handleItemChange({ 
                    getFormContext: () => ctx,
                    getEventSource: () => ({ getName: () => "pdg_itemid" })
                });
                
            } else if (result.entities.length > 1) {
                ctx.ui.setFormNotification(
                    `⚠️ Multiple items found with barcode ${barcode}. Please select manually.`,
                    "WARNING",
                    "barcode_multiple"
                );
                await showItemSelectionDialog(ctx, result.entities);
            } else {
                ctx.ui.setFormNotification(
                    `❌ No item found with barcode: ${barcode}`,
                    "ERROR",
                    "barcode_not_found"
                );
                ctx.getAttribute("pdg_barcode_scan").setValue(null);
            }
            
        } catch (error) {
            console.error("Barcode lookup error:", error);
            ctx.ui.setFormNotification(
                "Error looking up barcode. Please try again.",
                "ERROR",
                "barcode_error"
            );
        }
    }

    async function handleFromInventoryBarcode(executionContext) {
        const ctx = executionContext.getFormContext();
        const barcode = ctx.getAttribute("pdg_from_inventory_barcode").getValue();
        
        if (!barcode || barcode.trim() === '') return;
        await processInventoryBarcode(ctx, barcode, "from");
    }

    async function handleToInventoryBarcode(executionContext) {
        const ctx = executionContext.getFormContext();
        const barcode = ctx.getAttribute("pdg_to_inventory_barcode").getValue();
        
        if (!barcode || barcode.trim() === '') return;
        await processInventoryBarcode(ctx, barcode, "to");
    }

    async function processInventoryBarcode(ctx, barcode, direction) {
        try {
            const item = ctx.getAttribute("pdg_itemid").getValue();
            const warehouse = ctx.getAttribute(`pdg_${direction}warehouseid`).getValue();
            
            if (!item) {
                ctx.ui.setFormNotification("Please select an item first", "WARNING", `${direction}_inv_barcode_no_item`);
                ctx.getAttribute(`pdg_${direction}_inventory_barcode`).setValue(null);
                return;
            }
            
            if (!warehouse) {
                ctx.ui.setFormNotification("Please select a warehouse first", "WARNING", `${direction}_inv_barcode_no_wh`);
                ctx.getAttribute(`pdg_${direction}_inventory_barcode`).setValue(null);
                return;
            }
            
            const cleanItemId = item[0].id.replace(/[{}]/g, "");
            const cleanWhId = warehouse[0].id.replace(/[{}]/g, "");
            
            const result = await Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
                `?$select=pdg_inventoryid,pdg_inventorynumber,pdg_onhandquantity,pdg_binnumber&$filter=_pdg_itemid_value eq ${cleanItemId} and _pdg_warehouseid_value eq ${cleanWhId} and pdg_binnumber eq '${barcode.trim()}' and statecode eq 0`);
            
            if (result.entities.length === 1) {
                const inventory = result.entities[0];
                
                ctx.getAttribute(`pdg_${direction}inventoryid`).setValue([{
                    id: inventory.pdg_inventoryid,
                    name: inventory.pdg_inventorynumber || "Inventory Record",
                    entityType: "pdg_inventory"
                }]);
                
                ctx.getAttribute(`pdg_${direction}_inventory_barcode`).setValue(null);
                
                ctx.ui.setFormNotification(
                    `✅ ${direction === 'from' ? 'Source' : 'Destination'} inventory found: Bin ${barcode} (Stock: ${(inventory.pdg_onhandquantity || 0).toFixed(2)})`,
                    "INFO",
                    `${direction}_inv_barcode_success`
                );
                
            } else {
                ctx.ui.setFormNotification(
                    `❌ No inventory found in bin: ${barcode}`,
                    "ERROR",
                    `${direction}_inv_barcode_not_found`
                );
                ctx.getAttribute(`pdg_${direction}_inventory_barcode`).setValue(null);
            }
            
        } catch (error) {
            console.error("Inventory barcode lookup error:", error);
            ctx.ui.setFormNotification(
                "Error looking up inventory barcode",
                "ERROR",
                `${direction}_inv_barcode_error`
            );
        }
    }

    async function showItemSelectionDialog(ctx, items) {
        try {
            const lookupOptions = {
                entityTypes: ["pdg_inventoryitem"],
                allowMultiSelect: false,
                defaultEntityType: "pdg_inventoryitem",
                searchText: items[0].pdg_barcode || items[0].pdg_qrcode
            };
            
            const selectedItems = await Xrm.Utility.lookupObjects(lookupOptions);
            
            if (selectedItems && selectedItems.length > 0) {
                ctx.getAttribute("pdg_itemid").setValue([{
                    id: selectedItems[0].id,
                    name: selectedItems[0].name,
                    entityType: "pdg_inventoryitem"
                }]);
                
                ctx.getAttribute("pdg_barcode_scan").setValue(null);
                
                await handleItemChange({ 
                    getFormContext: () => ctx,
                    getEventSource: () => ({ getName: () => "pdg_itemid" })
                });
            }
        } catch (error) {
            console.error("Error showing item selection dialog:", error);
        }
    }

    // === Reference Type Handling ===
    function handleReferenceTypeChange(executionContext) {
        const ctx = executionContext.getFormContext();
        const referenceType = ctx.getAttribute("pdg_referencetype").getValue();
        
        const refNumberControl = ctx.getControl("pdg_referencenumber");
        const refIdControl = ctx.getControl("pdg_referenceid");
        
        const isManual = (referenceType === REFERENCE_TYPE.MANUAL);
        
        if (refNumberControl) refNumberControl.setDisabled(!isManual);
        if (refIdControl) refIdControl.setDisabled(!isManual);
        
        const helpText = {
            [REFERENCE_TYPE.PURCHASE]: "Reference will link to Purchase Order",
            [REFERENCE_TYPE.SALES]: "Reference will link to Sales Order", 
            [REFERENCE_TYPE.PRODUCTION]: "Reference will link to Production Sheet",
            [REFERENCE_TYPE.TRANSFER]: "Reference will link to Transfer Request",
            [REFERENCE_TYPE.MANUAL]: "Manual entry - you can specify custom reference"
        };
        
        if (helpText[referenceType]) {
            ctx.ui.setFormNotification(helpText[referenceType], "INFO", "reference_help");
        }
    }

    // === UI Visibility ===
    function handleTransactionTypeChange(executionContext){
        const ctx = executionContext.getFormContext();
        clearFormNotifications(ctx);
        updateFieldVisibility(ctx);
        refreshAllFilters(ctx);
    }

    function updateFieldLabels(ctx, type) {
        const fromWarehouseControl = ctx.getControl("pdg_fromwarehouseid");
        const toWarehouseControl = ctx.getControl("pdg_towarehouseid");
        
        if (fromWarehouseControl) {
            const fromLabel = type === TRANSACTION_TYPE.TRANSFER ? "From Warehouse" : "Source Warehouse";
            fromWarehouseControl.setLabel(fromLabel);
        }
        
        if (toWarehouseControl) {
            const toLabel = type === TRANSACTION_TYPE.TRANSFER ? "To Warehouse" : "Destination Warehouse";
            toWarehouseControl.setLabel(toLabel);
        }
    }

    function toggleFieldVisibility(ctx, fieldName, visible){
        const ctrl = ctx.getControl(fieldName);
        if (ctrl) ctrl.setVisible(visible);
    }

    // === Field Change Handlers ===
    async function handleItemChangeWithBarcode(executionContext) {
        const ctx = executionContext.getFormContext();
        
        const barcodeNotifications = [
            "barcode_lookup", "barcode_success", "barcode_multiple", 
            "barcode_not_found", "barcode_error"
        ];
        barcodeNotifications.forEach(id => ctx.ui.clearFormNotification(id));
        
        await handleItemChange(executionContext);
    }

    async function handleItemChange(executionContext){
        const ctx = executionContext.getFormContext();
        const item = ctx.getAttribute("pdg_itemid").getValue();
        
        clearWarehousesAndInventories(ctx);
        clearFormNotifications(ctx);
        
        if (item) {
            await loadItemInformation(ctx, item[0].id);
        }
        
        updateFieldVisibility(ctx);
        await refreshAllFilters(ctx);
    }

    async function handleWarehouseChange(executionContext){
        const ctx = executionContext.getFormContext();
        const fieldName = executionContext.getEventSource().getName();
        
        if (fieldName === "pdg_fromwarehouseid") {
            ctx.getAttribute("pdg_frominventoryid").setValue(null);
        } else if (fieldName === "pdg_towarehouseid") {
            ctx.getAttribute("pdg_toinventoryid").setValue(null);
        }
        
        // Update field states (enable/disable inventory fields)
        updateFieldVisibility(ctx);
        await refreshAllFilters(ctx);
        await autoFillInventory(ctx, fieldName);
    }

    async function handleQuantityChange(executionContext) {
        const ctx = executionContext.getFormContext();
        calculateTotalCost(executionContext);
        await validateStockSufficiency(ctx);
    }

    function calculateTotalCost(executionContext){
        const ctx = executionContext.getFormContext();
        const qty = ctx.getAttribute("pdg_quantity").getValue() || 0;
        const unitCost = ctx.getAttribute("pdg_unitcost").getValue() || 0;
        ctx.getAttribute("pdg_totalcost").setValue(qty * unitCost);
    }

    // === Stock Sufficiency Validation ===
    async function validateStockSufficiency(ctx) {
        const type = ctx.getAttribute("pdg_transactiontype").getValue();
        const quantity = ctx.getAttribute("pdg_quantity").getValue() || 0;
        const fromInv = ctx.getAttribute("pdg_frominventoryid").getValue();
        
        // Clear previous stock validation notifications
        ctx.ui.clearFormNotification("stock_insufficient");
        ctx.ui.clearFormNotification("stock_warning");
        ctx.ui.clearFormNotification("stock_sufficient");
        
        // Only validate for outbound transactions
        if (![TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.TRANSFER].includes(type) || !fromInv || quantity <= 0) {
            return;
        }
        
        try {
            const cleanInvId = fromInv[0].id.replace(/[{}]/g, "");
            const inventory = await Xrm.WebApi.retrieveRecord("pdg_inventory", cleanInvId,
                "?$select=pdg_onhandquantity,pdg_onlinequantity,pdg_reservedquantity");
            
            const onHand = inventory.pdg_onhandquantity || 0;
            const available = inventory.pdg_onlinequantity || 0;
            const reserved = inventory.pdg_reservedquantity || 0;
            
            if (available < quantity) {
                ctx.ui.setFormNotification(
                    `❌ Insufficient stock! Available: ${available.toFixed(2)}, Required: ${quantity.toFixed(2)} (On Hand: ${onHand.toFixed(2)}, Reserved: ${reserved.toFixed(2)})`,
                    "ERROR",
                    "stock_insufficient"
                );
            } else if (available < quantity * 1.1) { // Warning when close to limit
                ctx.ui.setFormNotification(
                    `⚠️ Low stock warning! Available: ${available.toFixed(2)}, Required: ${quantity.toFixed(2)} (On Hand: ${onHand.toFixed(2)})`,
                    "WARNING",
                    "stock_warning"
                );
            } else {
                ctx.ui.setFormNotification(
                    `✅ Stock sufficient! Available: ${available.toFixed(2)}, Required: ${quantity.toFixed(2)}`,
                    "INFO",
                    "stock_sufficient"
                );
            }
        } catch (error) {
            console.error("Error validating stock sufficiency:", error);
        }
    }

    // === Data Loading ===
    async function loadItemInformation(ctx, itemId){
        try {
            const cleanId = itemId.replace(/[{}]/g, "");
            const item = await Xrm.WebApi.retrieveRecord("pdg_inventoryitem", cleanId, 
                "?$select=pdg_name,pdg_qrcode,pdg_unitcost,pdg_cogp,pdg_quantityonhand,pdg_measurementunit");
            
            if (!ctx.getAttribute("pdg_unitcost").getValue()) {
                const cost = item.pdg_unitcost || item.pdg_cogp || 0;
                ctx.getAttribute("pdg_unitcost").setValue(cost);
                calculateTotalCost({ getFormContext: () => ctx });
            }
            
            const unit = item.pdg_measurementunit || "units";
            const totalStock = item.pdg_quantityonhand || 0;
            
            ctx.ui.setFormNotification(
                `📦 ${item.pdg_name} (${item.pdg_qrcode}) | Cost: $${(item.pdg_unitcost || 0).toFixed(2)} | Total Stock: ${totalStock} ${unit}`,
                "INFO", 
                "item_info"
            );
            
        } catch (error) {
            console.error("Error loading item information:", error);
            ctx.ui.setFormNotification("Error loading item information", "WARNING", "item_error");
        }
    }

    // === Enhanced Filtering Logic ===
    async function refreshAllFilters(ctx){
        const item = ctx.getAttribute("pdg_itemid").getValue();
        if (!item) {
            ctx.PDG_FilterData = null;
            return;
        }
        const type = ctx.getAttribute("pdg_transactiontype").getValue();

        await setupFilterData(ctx, item[0].id, type);
        setupPreSearchFilters(ctx);
    }

    async function setupFilterData(ctx, itemId, type){
        try {
            const cleanId = itemId.replace(/[{}]/g, "");
            
            // Initialize filter data
            ctx.PDG_FilterData = {
                itemId: itemId,
                type: type,
                warehousesWithStock: [],
                warehousesWithItem: [],
                allWarehouses: [],
                stockData: new Map()
            };

            // Get all warehouses where item exists (with or without stock)
            const allInventoryResult = await Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
                `?$select=_pdg_warehouseid_value,pdg_onhandquantity,pdg_onlinequantity&$filter=_pdg_itemid_value eq ${cleanId} and statecode eq 0`);
            
            // Get warehouses with stock > 0
            const stockInventoryResult = await Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
                `?$select=_pdg_warehouseid_value,pdg_onhandquantity,pdg_onlinequantity&$filter=_pdg_itemid_value eq ${cleanId} and pdg_onhandquantity gt 0 and statecode eq 0`);
            
            // Process results
            const warehousesWithItem = [...new Set(allInventoryResult.entities.map(r => r._pdg_warehouseid_value))];
            const warehousesWithStock = [...new Set(stockInventoryResult.entities.map(r => r._pdg_warehouseid_value))];
            
            // Store stock data for each warehouse
            allInventoryResult.entities.forEach(inv => {
                const whId = inv._pdg_warehouseid_value;
                if (!ctx.PDG_FilterData.stockData.has(whId)) {
                    ctx.PDG_FilterData.stockData.set(whId, {
                        onHand: 0,
                        available: 0
                    });
                }
                const existing = ctx.PDG_FilterData.stockData.get(whId);
                existing.onHand += (inv.pdg_onhandquantity || 0);
                existing.available += (inv.pdg_onlinequantity || 0);
            });
            
            ctx.PDG_FilterData.warehousesWithItem = warehousesWithItem;
            ctx.PDG_FilterData.warehousesWithStock = warehousesWithStock;
            
            // Calculate totals for display
            const totalStock = stockInventoryResult.entities.reduce((sum, e) => sum + (e.pdg_onhandquantity || 0), 0);
            const totalAvailable = stockInventoryResult.entities.reduce((sum, e) => sum + (e.pdg_onlinequantity || 0), 0);
            
            // Show informative message based on transaction type and stock availability
            if (warehousesWithStock.length > 0) {
                ctx.ui.setFormNotification(
                    `📦 Item available in ${warehousesWithStock.length} warehouse(s) | Total Stock: ${totalStock.toFixed(2)} | Available: ${totalAvailable.toFixed(2)}`,
                    "INFO", 
                    "warehouse_info"
                );
            } else if (warehousesWithItem.length > 0) {
                ctx.ui.setFormNotification(
                    `📦 Item exists in ${warehousesWithItem.length} warehouse(s) but no stock available`,
                    "WARNING", 
                    "no_stock"
                );
            } else {
                ctx.ui.setFormNotification(
                    "📦 Item not found in any warehouse",
                    "INFO", 
                    "no_warehouses"
                );
            }
            
        } catch (err) { 
            console.error("Filter data setup error", err);
            ctx.ui.setFormNotification("Error loading filter data", "WARNING", "filter_error");
        }
    }

    function setupPreSearchFilters(ctx) {
        const fromWarehouseControl = ctx.getControl("pdg_fromwarehouseid");
        const toWarehouseControl = ctx.getControl("pdg_towarehouseid");
        const fromInvControl = ctx.getControl("pdg_frominventoryid");
        const toInvControl = ctx.getControl("pdg_toinventoryid");

        // Setup warehouse filters with pre-search
        if (fromWarehouseControl) {
            fromWarehouseControl.addPreSearch(() => applyFromWarehouseFilter(ctx));
        }
        
        if (toWarehouseControl) {
            toWarehouseControl.addPreSearch(() => applyToWarehouseFilter(ctx));
        }

        // Setup inventory filters with pre-search
        if (fromInvControl) {
            fromInvControl.addPreSearch(() => applyFromInventoryFilter(ctx));
        }
        
        if (toInvControl) {
            toInvControl.addPreSearch(() => applyToInventoryFilter(ctx));
        }
    }

    // === Enhanced Warehouse Filtering ===
    function applyFromWarehouseFilter(ctx) {
        const fromCtrl = ctx.getControl("pdg_fromwarehouseid");
        if (!fromCtrl || !ctx.PDG_FilterData) return;

        clearFilter(fromCtrl);

        const { type, warehousesWithStock, warehousesWithItem } = ctx.PDG_FilterData;
        let targetWarehouses = [];

        // Apply transaction type specific filtering
        switch (type) {
            case TRANSACTION_TYPE.ISSUE:
            case TRANSACTION_TYPE.TRANSFER:
                // Must have stock
                targetWarehouses = warehousesWithStock;
                break;
                
            case TRANSACTION_TYPE.ADJUSTMENT:
            case TRANSACTION_TYPE.COUNT:
                // Can include warehouses with zero stock
                targetWarehouses = warehousesWithItem;
                break;
                
            default:
                // No specific filtering
                targetWarehouses = [];
        }

        // Apply warehouse filter if we have specific warehouses
        if (targetWarehouses.length > 0) {
            addWarehouseFilter(fromCtrl, targetWarehouses);
        }

        // For transfers, exclude destination warehouse
        if (type === TRANSACTION_TYPE.TRANSFER) {
            const toWh = ctx.getAttribute("pdg_towarehouseid").getValue();
            if (toWh) {
                const excludeFilter = `<filter type='and'>
                    <condition attribute='pdg_warehouseid' operator='ne' value='${toWh[0].id.replace(/[{}]/g, "")}' />
                    <condition attribute='statecode' operator='eq' value='0' />
                </filter>`;
                addCustomFilter(fromCtrl, excludeFilter);
            }
        }

        // Always ensure active warehouses only
        if (targetWarehouses.length === 0) {
            const activeFilter = `<filter type='and'>
                <condition attribute='statecode' operator='eq' value='0' />
            </filter>`;
            addCustomFilter(fromCtrl, activeFilter);
        }
    }

    function applyToWarehouseFilter(ctx) {
        const toCtrl = ctx.getControl("pdg_towarehouseid");
        if (!toCtrl || !ctx.PDG_FilterData) return;

        clearFilter(toCtrl);

        const { type, warehousesWithItem } = ctx.PDG_FilterData;

        // For transfers, exclude source warehouse
        if (type === TRANSACTION_TYPE.TRANSFER) {
            const fromWh = ctx.getAttribute("pdg_fromwarehouseid").getValue();
            if (fromWh) {
                const excludeFilter = `<filter type='and'>
                    <condition attribute='pdg_warehouseid' operator='ne' value='${fromWh[0].id.replace(/[{}]/g, "")}' />
                    <condition attribute='statecode' operator='eq' value='0' />
                </filter>`;
                addCustomFilter(toCtrl, excludeFilter);
                return; // Early return for transfers with exclusion
            }
        }

        // For receipts, we might want to show all warehouses or prefer existing ones
        if (type === TRANSACTION_TYPE.RECEIPT && warehousesWithItem.length > 0) {
            // Show existing item warehouses first, but allow all
            addWarehouseFilter(toCtrl, warehousesWithItem, false); // false = don't restrict, just prefer
        }

        // Standard active warehouse filter
        const activeFilter = `<filter type='and'>
            <condition attribute='statecode' operator='eq' value='0' />
        </filter>`;
        addCustomFilter(toCtrl, activeFilter);
    }

    function applyFromInventoryFilter(ctx) {
        const fromInvCtrl = ctx.getControl("pdg_frominventoryid");
        if (!fromInvCtrl || !ctx.PDG_FilterData) return;

        clearFilter(fromInvCtrl);

        const item = ctx.getAttribute("pdg_itemid").getValue();
        const fromWh = ctx.getAttribute("pdg_fromwarehouseid").getValue();
        const type = ctx.getAttribute("pdg_transactiontype").getValue();
        
        if (item && fromWh) {
            let filter = makeItemWarehouseFilter(item[0].id, fromWh[0].id);
            
            // For outbound transactions, add stock > 0 requirement
            if ([TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.TRANSFER].includes(type)) {
                filter = filter.replace('</filter>', 
                    '<condition attribute="pdg_onhandquantity" operator="gt" value="0" /></filter>');
            }
            
            addCustomFilter(fromInvCtrl, filter);
        }
    }

    function applyToInventoryFilter(ctx) {
        const toInvCtrl = ctx.getControl("pdg_toinventoryid");
        if (!toInvCtrl || !ctx.PDG_FilterData) return;

        clearFilter(toInvCtrl);

        const item = ctx.getAttribute("pdg_itemid").getValue();
        const toWh = ctx.getAttribute("pdg_towarehouseid").getValue();
        
        if (item && toWh) {
            const filter = makeItemWarehouseFilter(item[0].id, toWh[0].id);
            addCustomFilter(toInvCtrl, filter);
        }
    }

    function makeItemWarehouseFilter(itemId, whId){
        return `<filter type='and'>
                    <condition attribute='pdg_itemid' operator='eq' value='${itemId.replace(/[{}]/g,"")}' />
                    <condition attribute='pdg_warehouseid' operator='eq' value='${whId.replace(/[{}]/g,"")}' />
                    <condition attribute='statecode' operator='eq' value='0' />
                </filter>`;
    }

    // === Auto-fill Logic ===
    async function autoFillInventory(ctx, changedField){
        const item = ctx.getAttribute("pdg_itemid").getValue();
        if (!item) return;

        const whField = changedField === "pdg_fromwarehouseid" ? "pdg_fromwarehouseid" : "pdg_towarehouseid";
        const invField = changedField === "pdg_fromwarehouseid" ? "pdg_frominventoryid" : "pdg_toinventoryid";
        const whVal = ctx.getAttribute(whField).getValue();
        if (!whVal) return;

        try {
            const cleanItemId = item[0].id.replace(/[{}]/g, "");
            const cleanWhId = whVal[0].id.replace(/[{}]/g, "");
            const type = ctx.getAttribute("pdg_transactiontype").getValue();
            
            // Add stock filter for outbound transactions
            let stockFilter = "";
            if (invField === "pdg_frominventoryid" && [TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.TRANSFER].includes(type)) {
                stockFilter = " and pdg_onhandquantity gt 0";
            }
            
            const res = await Xrm.WebApi.retrieveMultipleRecords("pdg_inventory",
                `?$select=pdg_inventoryid,pdg_inventorynumber,pdg_onhandquantity,pdg_onlinequantity&$filter=_pdg_itemid_value eq ${cleanItemId} and _pdg_warehouseid_value eq ${cleanWhId} and statecode eq 0${stockFilter}`);
            
            if (res.entities.length === 1){
                const inv = res.entities[0];
                ctx.getAttribute(invField).setValue([{
                    id: inv.pdg_inventoryid,
                    name: inv.pdg_inventorynumber || "Inventory Record",
                    entityType: "pdg_inventory"
                }]);
                
                const direction = invField.includes('from') ? 'Source' : 'Destination';
                ctx.ui.setFormNotification(
                    `✅ ${direction} Inventory auto-selected | Stock: ${(inv.pdg_onhandquantity || 0).toFixed(2)} units | Available: ${(inv.pdg_onlinequantity || 0).toFixed(2)} units`,
                    "INFO", 
                    `${invField}_autofill`
                );
                
                // Trigger stock validation if this is the from inventory
                if (invField === "pdg_frominventoryid") {
                    await validateStockSufficiency(ctx);
                }
            } else if (res.entities.length > 1){
                ctx.ui.setFormNotification(
                    `⚠️ Multiple inventory records found. Please select manually.`,
                    "WARNING", 
                    `${invField}_multiple`
                );
            } else {
                if (invField.includes('to')) {
                    ctx.ui.setFormNotification(
                        `ℹ️ Item doesn't exist in destination warehouse - new inventory record will be created`,
                        "INFO", 
                        `${invField}_new`
                    );
                } else {
                    ctx.ui.setFormNotification(
                        `⚠️ No inventory records found with stock in this warehouse`,
                        "WARNING", 
                        `${invField}_no_stock`
                    );
                }
            }
        } catch (err) { 
            console.error("Auto-fill inventory error", err);
            ctx.ui.setFormNotification("Error auto-filling inventory", "WARNING", "autofill_error");
        }
    }

    // === Save Validation ===
    async function onSaveValidation(e, ctx){
        const args = e.getEventArgs();
        clearFormNotifications(ctx, ["validation"]);
        
        try {
            const item = ctx.getAttribute("pdg_itemid").getValue();
            const qty = ctx.getAttribute("pdg_quantity").getValue() || 0;
            const unitCost = ctx.getAttribute("pdg_unitcost").getValue() || 0;
            const fromWh = ctx.getAttribute("pdg_fromwarehouseid").getValue();
            const toWh = ctx.getAttribute("pdg_towarehouseid").getValue();
            const fromInv = ctx.getAttribute("pdg_frominventoryid").getValue();
            const toInv = ctx.getAttribute("pdg_toinventoryid").getValue();
            const type = ctx.getAttribute("pdg_transactiontype").getValue();
            const reason = ctx.getAttribute("pdg_reason").getValue();

            // Basic validations
            if (!item) {
                ctx.ui.setFormNotification("Item is required", "ERROR", "val_item");
                args.preventDefault(); return;
            }
            
            if (qty <= 0) {
                ctx.ui.setFormNotification("Quantity must be greater than zero", "ERROR", "val_qty");
                args.preventDefault(); return;
            }

            if (unitCost <= 0) {
                ctx.ui.setFormNotification("Unit cost must be greater than zero", "ERROR", "val_cost");
                args.preventDefault(); return;
            }

            // Reason validation for certain transaction types
            if ([TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.ADJUSTMENT].includes(type) && !reason) {
                ctx.ui.setFormNotification("Reason is required for this transaction type", "ERROR", "val_reason");
                args.preventDefault(); return;
            }

            // Transfer validation
            if (type === TRANSACTION_TYPE.TRANSFER && fromWh && toWh && fromWh[0].id === toWh[0].id){
                ctx.ui.setFormNotification("From and To Warehouse cannot be the same for transfer", "ERROR", "val_same_wh");
                args.preventDefault(); return;
            }

            // Warehouse requirements
            if ([TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.TRANSFER, TRANSACTION_TYPE.ADJUSTMENT, TRANSACTION_TYPE.COUNT].includes(type) && !fromWh) {
                ctx.ui.setFormNotification("Source warehouse is required", "ERROR", "val_from_wh");
                args.preventDefault(); return;
            }
            
            if ([TRANSACTION_TYPE.RECEIPT, TRANSACTION_TYPE.TRANSFER].includes(type) && !toWh) {
                ctx.ui.setFormNotification("Destination warehouse is required", "ERROR", "val_to_wh");
                args.preventDefault(); return;
            }

            // Validate inventory records
            await validateInventoryRecord(ctx, fromInv, fromWh, item, args, "From Inventory", "val_from_inv");
            await validateInventoryRecord(ctx, toInv, toWh, item, args, "To Inventory", "val_to_inv");

            // Stock check for outbound transactions (final validation)
            if ([TRANSACTION_TYPE.ISSUE, TRANSACTION_TYPE.TRANSFER].includes(type) && fromInv){
                const invRec = await Xrm.WebApi.retrieveRecord("pdg_inventory", 
                    fromInv[0].id.replace(/[{}]/g, ""), 
                    "?$select=pdg_onhandquantity,pdg_onlinequantity");
                    
                const available = invRec.pdg_onlinequantity || 0;
                if (available < qty){
                    ctx.ui.setFormNotification(
                        `Insufficient available stock. Available: ${available.toFixed(2)}, Required: ${qty.toFixed(2)}`,
                        "ERROR", 
                        "val_stock"
                    );
                    args.preventDefault(); return;
                }
            }
        } catch (err) { 
            console.error("Save validation error", err);
            ctx.ui.setFormNotification("Validation error: " + err.message, "ERROR", "val_error");
            args.preventDefault();
        }
    }

    async function validateInventoryRecord(ctx, inv, wh, item, args, label, notificationId){
        if (!inv || !wh) return;
        
        try {
            const rec = await Xrm.WebApi.retrieveRecord("pdg_inventory", 
                inv[0].id.replace(/[{}]/g,""), 
                "?$select=_pdg_itemid_value,_pdg_warehouseid_value");
                
            const itemMatch = rec._pdg_itemid_value === item[0].id.replace(/[{}]/g,"");
            const whMatch = rec._pdg_warehouseid_value === wh[0].id.replace(/[{}]/g,"");
            
            if (!itemMatch || !whMatch){
                ctx.ui.setFormNotification(
                    `${label} does not match selected Item/Warehouse`,
                    "ERROR", 
                    notificationId
                );
                args.preventDefault();
            }
        } catch (err) {
            console.error(`Error validating ${label}:`, err);
            ctx.ui.setFormNotification(`Error validating ${label}`, "ERROR", notificationId);
            args.preventDefault();
        }
    }

    // === Transaction Posting ===
    async function postTransaction(primaryControl) {
        const ctx = primaryControl || Xrm.Page;
        const transactionId = ctx.data.entity.getId();
        
        if (!transactionId) {
            Xrm.Navigation.openAlertDialog({
                text: "Please save the transaction first before posting.",
                title: "Save Required"
            });
            return;
        }

        if (!await validateForPosting(ctx)) {
            return;
        }

        const confirmed = await Xrm.Navigation.openConfirmDialog({
            text: "Are you sure you want to post this transaction? This will update inventory levels and cannot be undone.",
            title: "Confirm Posting"
        });

        if (confirmed.confirmed) {
            await executePosting(ctx, transactionId);
        }
    }

    async function validateForPosting(ctx) {
        try {
            const status = ctx.getAttribute("pdg_transactionstatus").getValue();
            if (status !== STATUS.DRAFT) {
                Xrm.Navigation.openAlertDialog({
                    text: "Only draft transactions can be posted.",
                    title: "Invalid Status"
                });
                return false;
            }

            return true;
        } catch (error) {
            console.error("Error validating for posting:", error);
            return false;
        }
    }

    async function executePosting(ctx, transactionId) {
        Xrm.Utility.showProgressIndicator("Posting transaction and updating inventory...");
        
        try {
            const type = ctx.getAttribute("pdg_transactiontype").getValue();
            const item = ctx.getAttribute("pdg_itemid").getValue();
            const qty = ctx.getAttribute("pdg_quantity").getValue();
            const unitCost = ctx.getAttribute("pdg_unitcost").getValue();
            const fromWh = ctx.getAttribute("pdg_fromwarehouseid").getValue();
            const toWh = ctx.getAttribute("pdg_towarehouseid").getValue();
            const fromInv = ctx.getAttribute("pdg_frominventoryid").getValue();
            const toInv = ctx.getAttribute("pdg_toinventoryid").getValue();

            switch (type) {
                case TRANSACTION_TYPE.RECEIPT:
                    await processStockIn(item[0].id, toWh[0].id, toInv ? toInv[0].id : null, qty, unitCost);
                    break;
                case TRANSACTION_TYPE.ISSUE:
                    await processStockOut(item[0].id, fromWh[0].id, fromInv[0].id, qty);
                    break;
                case TRANSACTION_TYPE.TRANSFER:
                    await processTransfer(item[0].id, fromWh[0].id, toWh[0].id, fromInv[0].id, toInv ? toInv[0].id : null, qty, unitCost);
                    break;
                case TRANSACTION_TYPE.ADJUSTMENT:
                    await processAdjustment(item[0].id, fromWh[0].id, fromInv[0].id, qty, unitCost);
                    break;
                case TRANSACTION_TYPE.COUNT:
                    await processPhysicalCount(item[0].id, fromWh[0].id, fromInv[0].id, qty);
                    break;
            }

            await Xrm.WebApi.updateRecord("pdg_inventorytransaction", 
                transactionId.replace(/[{}]/g, ""), {
                pdg_transactionstatus: STATUS.POSTED
            });

            Xrm.Utility.closeProgressIndicator();
            
            ctx.data.refresh(false).then(() => {
                lockPostedTransactions(ctx);
                Xrm.Navigation.openAlertDialog({
                    text: "Transaction posted successfully! Inventory has been updated.",
                    title: "Transaction Posted"
                });
            });

        } catch (error) {
            Xrm.Utility.closeProgressIndicator();
            console.error("Error posting transaction:", error);
            Xrm.Navigation.openErrorDialog({
                message: "Error posting transaction: " + error.message
            });
        }
    }

    // === Inventory Update Functions ===
    async function processStockIn(itemId, warehouseId, inventoryId, quantity, unitCost) {
        if (inventoryId) {
            await updateInventoryQuantity(inventoryId, quantity, true, unitCost);
        } else {
            await createInventoryRecord(itemId, warehouseId, quantity, unitCost);
        }
    }

    async function processStockOut(itemId, warehouseId, inventoryId, quantity) {
        await updateInventoryQuantity(inventoryId, quantity, false);
    }

    async function processTransfer(itemId, fromWhId, toWhId, fromInvId, toInvId, quantity, unitCost) {
        await updateInventoryQuantity(fromInvId, quantity, false);
        
        if (toInvId) {
            await updateInventoryQuantity(toInvId, quantity, true, unitCost);
        } else {
            await createInventoryRecord(itemId, toWhId, quantity, unitCost);
        }
    }

    async function processAdjustment(itemId, warehouseId, inventoryId, quantity, unitCost) {
        await setInventoryQuantity(inventoryId, quantity, unitCost);
    }

    async function processPhysicalCount(itemId, warehouseId, inventoryId, quantity) {
        await setInventoryQuantity(inventoryId, quantity);
    }

    async function updateInventoryQuantity(inventoryId, quantity, isIncrease, unitCost = null) {
        const cleanId = inventoryId.replace(/[{}]/g, "");
        const current = await Xrm.WebApi.retrieveRecord("pdg_inventory", cleanId, 
            "?$select=pdg_onhandquantity,pdg_onlinequantity");
        
        const multiplier = isIncrease ? 1 : -1;
        const newOnHand = Math.max(0, (current.pdg_onhandquantity || 0) + (quantity * multiplier));
        const newOnLine = Math.max(0, (current.pdg_onlinequantity || 0) + (quantity * multiplier));
        
        const updateData = {
            pdg_onhandquantity: newOnHand,
            pdg_onlinequantity: newOnLine,
            pdg_lastupdated: new Date(),
            pdg_lastmovementdate: new Date()
        };
        
        if (unitCost !== null) {
            updateData.pdg_costprice = unitCost;
        }
        
        await Xrm.WebApi.updateRecord("pdg_inventory", cleanId, updateData);
    }

    async function setInventoryQuantity(inventoryId, quantity, unitCost = null) {
        const cleanId = inventoryId.replace(/[{}]/g, "");
        const updateData = {
            pdg_onhandquantity: quantity,
            pdg_onlinequantity: quantity,
            pdg_lastupdated: new Date(),
            pdg_lastcountdate: new Date()
        };
        
        if (unitCost !== null) {
            updateData.pdg_costprice = unitCost;
        }
        
        await Xrm.WebApi.updateRecord("pdg_inventory", cleanId, updateData);
    }

    async function createInventoryRecord(itemId, warehouseId, quantity, unitCost) {
        const cleanItemId = itemId.replace(/[{}]/g, "");
        const cleanWhId = warehouseId.replace(/[{}]/g, "");
        
        const createData = {
            [`pdg_itemid@odata.bind`]: `/pdg_inventoryitems(${cleanItemId})`,
            [`pdg_warehouseid@odata.bind`]: `/pdg_warehouses(${cleanWhId})`,
            pdg_onhandquantity: quantity,
            pdg_onlinequantity: quantity,
            pdg_reservedquantity: 0,
            pdg_costprice: unitCost || 0,
            pdg_lastupdated: new Date(),
            pdg_lastmovementdate: new Date(),
            pdg_inventorynumber: `INV-${Date.now()}`
        };
        
        await Xrm.WebApi.createRecord("pdg_inventory", createData);
    }

    // === Helper Functions ===
    function addWarehouseFilter(ctrl, ids, restrictive = true){
        if (!ctrl || !ids.length) return;
        
        const condition = restrictive ? 'in' : 'in'; // Could add preference logic here
        let xml = `<filter type='and'><condition attribute='pdg_warehouseid' operator='${condition}'>`;
        ids.forEach(id => { xml += `<value>${id}</value>`; });
        xml += "</condition><condition attribute='statecode' operator='eq' value='0' /></filter>";
        addCustomFilter(ctrl, xml);
    }

    function addCustomFilter(ctrl, xml){
        if (ctrl && typeof ctrl.addCustomFilter === 'function') {
            try {
                ctrl.addCustomFilter(xml);
            } catch (error) {
                console.warn("Error adding custom filter:", error);
            }
        }
    }

    function clearFilter(ctrl){
        if (ctrl && typeof ctrl.clearCustomFilters === 'function') {
            try {
                ctrl.clearCustomFilters();
            } catch (error) {
                console.warn("Error clearing filters:", error);
            }
        }
    }

    function clearWarehousesAndInventories(ctx){
        const fields = ["pdg_fromwarehouseid","pdg_towarehouseid","pdg_frominventoryid","pdg_toinventoryid"];
        fields.forEach(field => {
            const attr = ctx.getAttribute(field);
            if (attr) attr.setValue(null);
        });
    }

    function clearFormNotifications(ctx, categories = []){
        const allNotifications = [
            // General notifications
            "item_info", "item_error", "warehouse_info", "no_stock", "no_warehouses", "filter_error", "reference_help",
            "transaction_locked", "barcode_tip",
            // Stock validation
            "stock_insufficient", "stock_warning", "stock_sufficient",
            // Validation notifications  
            "val_item", "val_qty", "val_cost", "val_reason", "val_same_wh", "val_from_wh", "val_to_wh",
            "val_from_inv", "val_to_inv", "val_stock", "val_error",
            // Barcode notifications
            "barcode_lookup", "barcode_success", "barcode_multiple", "barcode_not_found", "barcode_error",
            "from_inv_barcode_success", "from_inv_barcode_not_found", "from_inv_barcode_error", 
            "from_inv_barcode_no_item", "from_inv_barcode_no_wh",
            "to_inv_barcode_success", "to_inv_barcode_not_found", "to_inv_barcode_error",
            "to_inv_barcode_no_item", "to_inv_barcode_no_wh",
            // Auto-fill notifications
            "pdg_frominventoryid_autofill", "pdg_frominventoryid_multiple", "pdg_frominventoryid_no_stock",
            "pdg_toinventoryid_autofill", "pdg_toinventoryid_multiple", "pdg_toinventoryid_new"
        ];
        
        const toClear = categories.length ? 
            allNotifications.filter(n => categories.some(c => n.startsWith(c))) :
            allNotifications;
            
        toClear.forEach(id => ctx.ui.clearFormNotification(id));
    }

    // === Public API ===
    return { 
        onLoad: onLoad,
        postTransaction: postTransaction
    };
})();