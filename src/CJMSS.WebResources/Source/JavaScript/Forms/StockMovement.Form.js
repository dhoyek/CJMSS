// Enhanced Stock Movement Form JavaScript
// Namespace: PDG.StockMovement
// Added automatic lookup filtering based on Item, Warehouse, Inventory, and Bin relationships

var PDG = typeof PDG !== "undefined" ? PDG : {};
PDG.StockMovement = PDG.StockMovement || (function () {
    "use strict";

    // ====== Utility helpers ======
    function getAttr(fc, name) { try { return fc.getAttribute(name); } catch (e) { return null; } }
    function getCtrl(fc, name) { try { return fc.getControl(name); } catch (e) { return null; } }
    function getValue(fc, name, dflt) {
        var a = getAttr(fc, name);
        var v = a ? a.getValue() : null;
        return (v === null || v === undefined) ? (dflt === undefined ? null : dflt) : v;
    }
    function setValue(fc, name, v) {
        var a = getAttr(fc, name);
        if (a) a.setValue(v);
    }
    function setVisible(fc, name, vis) {
        var c = getCtrl(fc, name);
        if (c) c.setVisible(!!vis);
    }
    function notify(fc, text, level, id) {
        try { fc.ui.setFormNotification(text, level || "INFO", id || "pdg_sm_note"); } catch (e) { }
    }
    function clearNote(fc, id) {
        try { fc.ui.clearFormNotification(id || "pdg_sm_note"); } catch (e) { }
    }

    function guidClean(id) { return (id || "").replace(/[{}]/g, ""); }

    // ====== Public API ======
    var api = {};

    // --- Form events ---
    api.onLoad = function (ctx) {
        var fc = ctx.getFormContext();

        // Lock system-controlled fields first
        api.lockSystemFields(fc);

        // Wire change handlers and filtering
        api.setupChangeHandlers(fc);
        api.setupLookupFiltering(fc);

        // Default movement date
        if (fc.ui.getFormType() === 1 && !getValue(fc, "pdg_movementdate")) {
            setValue(fc, "pdg_movementdate", new Date());
        }

        // If item is present, hydrate related data
        var item = getValue(fc, "pdg_itemid");
        if (item && item[0] && item[0].id) {
            api.loadItemDetails(fc, guidClean(item[0].id));
        }

        // Apply initial filters for existing records
        api.applyInitialFilters(fc);

        // Layout
        api.adjustFormLayout(fc);
    };

    api.onSave = function (ctx) {
        var fc = ctx.getFormContext();
        // Full validation
        if (!api.validateBeforeSave(fc)) {
            ctx.getEventArgs().preventDefault();
            return;
        }
        // Calculations
        api.updateCalculatedFields(fc);
        api.setSystemFields(fc);
    };

    // --- Setup lookup filtering ---
    api.setupLookupFiltering = function (fc) {
        // Setup filtering for inventory lookup
        api.setupInventoryFiltering(fc);

        // Setup filtering for bin lookups
        api.setupBinFiltering(fc);
    };

    api.setupInventoryFiltering = function (fc) {
        var inventoryControl = getCtrl(fc, "pdg_inventoryid");
        if (inventoryControl && typeof inventoryControl.addPreSearch === "function") {
            try {
                inventoryControl.addPreSearch(function () {
                    api.filterInventoryLookup(fc);
                });
            } catch (e) {
                console.warn("Could not add preSearch to inventory control:", e);
            }
        }
    };

    api.setupBinFiltering = function (fc) {
        // Setup filtering for From Bin
        var fromBinControl = getCtrl(fc, "pdg_frombinid");
        if (fromBinControl && typeof fromBinControl.addPreSearch === "function") {
            try {
                fromBinControl.addPreSearch(function () {
                    api.filterBinLookup(fc, "pdg_frombinid");
                });
            } catch (e) {
                console.warn("Could not add preSearch to from bin control:", e);
            }
        }

        // Setup filtering for To Bin
        var toBinControl = getCtrl(fc, "pdg_tobinid");
        if (toBinControl && typeof toBinControl.addPreSearch === "function") {
            try {
                toBinControl.addPreSearch(function () {
                    api.filterBinLookup(fc, "pdg_tobinid");
                });
            } catch (e) {
                console.warn("Could not add preSearch to to bin control:", e);
            }
        }
    };

    api.applyInitialFilters = function (fc) {
        try {
            // Apply inventory filter if item and warehouse are already selected
            var item = getValue(fc, "pdg_itemid");
            var warehouse = getValue(fc, "pdg_warehouseid");

            if (item && warehouse) {
                api.filterInventoryLookup(fc);
            }

            if (warehouse) {
                api.filterBinLookup(fc, "pdg_frombinid");
                api.filterBinLookup(fc, "pdg_tobinid");
            }
        } catch (e) {
            console.warn("Error in initial filtering setup:", e);
        }
    };

    // --- Lookup filtering functions ---
    api.filterInventoryLookup = function (fc) {
        var itemId = getValue(fc, "pdg_itemid");
        var warehouseId = getValue(fc, "pdg_warehouseid");
        var inventoryControl = getCtrl(fc, "pdg_inventoryid");

        if (!inventoryControl) return;

        var filters = [];

        // Filter by item if selected
        if (itemId && itemId[0] && itemId[0].id) {
            var itemGuid = guidClean(itemId[0].id);
            filters.push("<condition attribute='pdg_itemid' operator='eq' value='" + itemGuid + "' />");
        }

        // Filter by warehouse if selected
        if (warehouseId && warehouseId[0] && warehouseId[0].id) {
            var warehouseGuid = guidClean(warehouseId[0].id);
            filters.push("<condition attribute='pdg_warehouseid' operator='eq' value='" + warehouseGuid + "' />");
        }

        // Only apply filter if we have at least one condition
        if (filters.length > 0) {
            try {
                var filterXml = "<filter type='and'>" + filters.join('') + "</filter>";
                inventoryControl.addCustomFilter(filterXml, "pdg_inventory");
                console.log("Applied inventory filter:", filterXml);
            } catch (e) {
                console.error("Error applying inventory filter:", e);
            }
        }
    };

    api.filterBinLookup = function (fc, controlName) {
        var warehouseId = getValue(fc, "pdg_warehouseid");
        var binControl = getCtrl(fc, controlName);

        if (!binControl || !warehouseId || !warehouseId[0] || !warehouseId[0].id) return;

        try {
            var warehouseGuid = guidClean(warehouseId[0].id);
            var filterXml = "<filter type='and'><condition attribute='pdg_warehouseid' operator='eq' value='" + warehouseGuid + "' /></filter>";

            binControl.addCustomFilter(filterXml, "pdg_bin");
            console.log("Applied bin filter for " + controlName + ":", filterXml);
        } catch (e) {
            console.error("Error applying bin filter for " + controlName + ":", e);
        }
    };

    // --- Enhanced change handlers with filtering ---
    api.setupChangeHandlers = function (fc) {
        var movementType = getAttr(fc, "pdg_movementtype");
        if (movementType) {
            movementType.addOnChange(function () {
                api.adjustFormLayout(fc);
                // Recalculate quantities when movement type changes
                api.updateCalculatedFields(fc);
                api.validateQuantities(fc);
            });
        }

        // Item change handler - clear dependent fields and apply filters
        var itemAttr = getAttr(fc, "pdg_itemid");
        if (itemAttr) {
            itemAttr.addOnChange(function (ctx) {
                var itemValue = ctx.getEventSource().getValue();

                // Clear dependent fields when item changes
                setValue(fc, "pdg_inventoryid", null);

                if (itemValue && itemValue[0] && itemValue[0].id) {
                    api.loadItemDetails(fc, guidClean(itemValue[0].id));
                }

                // Reapply inventory filtering
                api.filterInventoryLookup(fc);
            });
        }

        // Warehouse change handler - clear dependent fields and apply filters
        var warehouseAttr = getAttr(fc, "pdg_warehouseid");
        if (warehouseAttr) {
            warehouseAttr.addOnChange(function () {
                // Clear dependent fields when warehouse changes
                setValue(fc, "pdg_inventoryid", null);
                setValue(fc, "pdg_frombinid", null);
                setValue(fc, "pdg_tobinid", null);

                // Reapply all filters
                api.filterInventoryLookup(fc);
                api.filterBinLookup(fc, "pdg_frombinid");
                api.filterBinLookup(fc, "pdg_tobinid");
            });
        }

        // Inventory change handler - load inventory details
        var inventoryAttr = getAttr(fc, "pdg_inventoryid");
        if (inventoryAttr) {
            inventoryAttr.addOnChange(function (ctx) {
                var inventoryValue = ctx.getEventSource().getValue();
                if (inventoryValue && inventoryValue[0] && inventoryValue[0].id) {
                    api.loadInventoryDetails(fc, guidClean(inventoryValue[0].id));
                }
            });
        }

        var qtyAttr = getAttr(fc, "pdg_quantitychanged");
        if (qtyAttr) {
            qtyAttr.addOnChange(function () {
                // Automatically calculate quantity after when quantity changed
                api.updateCalculatedFields(fc);
                // Then validate the result
                api.validateQuantities(fc);
            });
        }

        // Add change handler for quantity before to recalculate when it changes
        var qtyBeforeAttr = getAttr(fc, "pdg_quantitybefore");
        if (qtyBeforeAttr) {
            qtyBeforeAttr.addOnChange(function () {
                api.updateCalculatedFields(fc);
                api.validateQuantities(fc);
            });
        }

        // Add change handler for Posted status
        var postedAttr = getAttr(fc, "pdg_posted");
        if (postedAttr) {
            postedAttr.addOnChange(function () {
                api.applyPostedStatusLocks(fc);
            });
        }
    };

    api.adjustFormLayout = function (fc) {
        // Enhanced visibility rules based on your actual Movement Type values
        var type = getValue(fc, "pdg_movementtype");
        // Normalize to number
        type = (typeof type === "object" && type && type.Value !== undefined) ? type.Value : type;

        // Defaults
        var showFrom = false, showTo = false, needReason = false;

        switch (type) {
            // Receipt/In movements - show To Bin only
            case 100100000: // Receipt
            case 100100006: // Production Receipt  
            case 100100009: // Purchase Receipt
                showTo = true;
                break;

            // Issue/Out movements - show From Bin only
            case 100100001: // Issue
            case 100100007: // Production Issue
            case 100100008: // Sales Issue
                showFrom = true;
                break;

            // Transfer movements - show both bins
            case 100100002: // Transfer-Out
            case 100100003: // Transfer-In
                showFrom = true;
                showTo = true;
                break;

            // Adjustment movements - show reason code
            case 100100004: // Adjustment
            case 100100005: // Physical Count
                needReason = true;
                break;

            // Return - could be either direction, show both for flexibility
            case 100100010: // Return
                showFrom = true;
                showTo = true;
                break;

            default:
                // Unknown movement type, show all fields for safety
                showFrom = true;
                showTo = true;
                needReason = true;
                break;
        }

        setVisible(fc, "pdg_frombinid", showFrom);
        setVisible(fc, "pdg_tobinid", showTo);
        setVisible(fc, "pdg_reasoncode", needReason);
    };

    // --- Enhanced data loading ---
    api.loadItemDetails = function (fc, itemId) {
        if (!itemId) return;

        // Align to Dataverse schema: pdg_inventoryitem fields
        var cols = "?$select=pdg_name,pdg_qrcode,pdg_serialcontrolled,pdg_unitcost,pdg_standardcost";
        Xrm.WebApi.retrieveRecord("pdg_inventoryitem", itemId, cols).then(function (res) {
            // If item requires serial control, show serial/lot fields
            var requiresSerial = !!res.pdg_serialcontrolled;
            setVisible(fc, "pdg_serialnumber", requiresSerial);
            setVisible(fc, "pdg_batchnumber", requiresSerial);
            setVisible(fc, "pdg_lotnumber", requiresSerial);

            // Set unit costs if available
            if (res.pdg_unitcost) {
                setValue(fc, "pdg_unitcostbefore", res.pdg_unitcost);
                setValue(fc, "pdg_unitcostafter", res.pdg_unitcost);
            } else if (res.pdg_standardcost) {
                setValue(fc, "pdg_unitcostbefore", res.pdg_standardcost);
                setValue(fc, "pdg_unitcostafter", res.pdg_standardcost);
            }

            notify(fc, "Item details loaded successfully", "INFO", "pdg_sm_item_loaded");
        }).catch(function (err) {
            console.error("loadItemDetails error:", err);
            notify(fc, "Error loading item details: " + (err.message || err), "WARNING", "pdg_sm_item_err");
        });
    };

    api.loadInventoryDetails = function (fc, inventoryId) {
        if (!inventoryId) return;

        var cols = "?$select=pdg_onhandquantity,pdg_availableforcommit,pdg_averagecost,pdg_costprice,pdg_standardcost";
        Xrm.WebApi.retrieveRecord("pdg_inventory", inventoryId, cols).then(function (res) {
            // Set quantity before from current inventory
            if (res.pdg_onhandquantity !== null && res.pdg_onhandquantity !== undefined) {
                setValue(fc, "pdg_quantitybefore", res.pdg_onhandquantity);
            }

            // Update cost information - use available cost fields from pdg_inventory
            if (res.pdg_costprice) {
                setValue(fc, "pdg_unitcostbefore", res.pdg_costprice);
                setValue(fc, "pdg_unitcostafter", res.pdg_costprice);
            } else if (res.pdg_averagecost) {
                setValue(fc, "pdg_unitcostbefore", res.pdg_averagecost);
                setValue(fc, "pdg_unitcostafter", res.pdg_averagecost);
            } else if (res.pdg_standardcost) {
                setValue(fc, "pdg_unitcostbefore", res.pdg_standardcost);
                setValue(fc, "pdg_unitcostafter", res.pdg_standardcost);
            }

            // Show available quantity info
            var availableQty = res.pdg_availableforcommit || res.pdg_onhandquantity || 0;
            notify(fc, "Available quantity: " + availableQty, "INFO", "pdg_sm_inventory_info");

        }).catch(function (err) {
            console.error("loadInventoryDetails error:", err);
            notify(fc, "Error loading inventory details: " + (err.message || err), "WARNING", "pdg_sm_inventory_err");
        });
    };

    // --- Validation (enhanced) ---
    api.validateBeforeSave = function (fc) {
        clearNote(fc, "pdg_sm_val");

        var msgs = [];
        if (!api.validateRequiredFields(fc, msgs)) { /* fallthrough */ }
        if (!api.validateMovementTypeRequirements(fc, msgs)) { /* fallthrough */ }
        if (!api.validateQuantities(fc, msgs)) { /* fallthrough */ }
        if (!api.validateAuthorization(fc, msgs)) { /* fallthrough */ }
        if (!api.validateInventorySelection(fc, msgs)) { /* fallthrough */ }

        if (msgs.length) {
            notify(fc, "Please fix the following before saving:\n• " + msgs.join("\n• "), "ERROR", "pdg_sm_val");
            return false;
        }
        return true;
    };

    api.validateRequiredFields = function (fc, bag) {
        var ok = true;
        function req(field, label) {
            var v = getValue(fc, field);
            var missing = (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
            if (missing) {
                ok = false;
                if (bag) bag.push(label + " is required");
            }
        }

        req("pdg_movementdate", "Movement Date");
        req("pdg_movementtype", "Movement Type");
        req("pdg_itemid", "Item");
        req("pdg_warehouseid", "Warehouse");
        req("pdg_inventoryid", "Inventory");
        req("pdg_quantitychanged", "Quantity Changed");

        return ok;
    };

    api.validateMovementTypeRequirements = function (fc, bag) {
        var ok = true;
        var type = getValue(fc, "pdg_movementtype");
        type = (typeof type === "object" && type && type.Value !== undefined) ? type.Value : type;

        var fromBin = getValue(fc, "pdg_frombinid");
        var toBin = getValue(fc, "pdg_tobinid");
        var reason = getValue(fc, "pdg_reasoncode");

        switch (type) {
            // Receipt movements - require To Bin
            case 100100000: // Receipt
            case 100100006: // Production Receipt
            case 100100009: // Purchase Receipt
                if (!toBin) {
                    ok = false;
                    if (bag) bag.push("To Bin is required for receipt movements");
                }
                break;

            // Issue movements - require From Bin
            case 100100001: // Issue
            case 100100007: // Production Issue
            case 100100008: // Sales Issue
                if (!fromBin) {
                    ok = false;
                    if (bag) bag.push("From Bin is required for issue movements");
                }
                break;

            // Transfer movements - require both bins
            case 100100002: // Transfer-Out
            case 100100003: // Transfer-In
                if (!fromBin || !toBin) {
                    ok = false;
                    if (bag) bag.push("From Bin and To Bin are required for transfer movements");
                }
                break;

            // Adjustment movements - require reason code
            case 100100004: // Adjustment
            case 100100005: // Physical Count
                if (!reason) {
                    ok = false;
                    if (bag) bag.push("Reason Code is required for adjustment movements");
                }
                break;

            // Return - require both bins for flexibility
            case 100100010: // Return
                if (!fromBin || !toBin) {
                    ok = false;
                    if (bag) bag.push("From Bin and To Bin are required for return movements");
                }
                break;
        }

        return ok;
    };

    api.validateInventorySelection = function (fc, bag) {
        var ok = true;
        // This validation is handled by the filtering, so we don't need additional checks here
        // The lookup filters ensure only valid combinations can be selected
        return ok;
    };

    api.validateQuantities = function (fc, bag) {
        var ok = true;
        var qty = Number(getValue(fc, "pdg_quantitychanged") || 0);
        var movementType = getValue(fc, "pdg_movementtype");
        var typeValue = 0;

        if (movementType) {
            typeValue = (typeof movementType === "object" && movementType && movementType.Value !== undefined) ? movementType.Value : movementType;
        }

        // Validate quantity changed - allow negative only for adjustments
        if (typeValue === 100100004 || typeValue === 100100005) { // Adjustment or Physical Count
            if (qty === 0) {
                ok = false;
                if (bag) bag.push("Adjustment quantity cannot be zero (use positive to increase, negative to decrease)");
            }
        } else {
            if (!(qty > 0)) {
                ok = false;
                if (bag) bag.push("Quantity Changed must be greater than zero");
            }
        }

        // Only validate quantity consistency if we have all the values
        var before = Number(getValue(fc, "pdg_quantitybefore") || 0);
        var after = Number(getValue(fc, "pdg_quantityafter") || 0);

        // Skip validation if quantities haven't been set yet
        if (before === 0 && after === 0) {
            clearNote(fc, "pdg_sm_qty_warn");
            return ok;
        }

        if (movementType && before !== 0) {
            var expectedAfter = before;

            switch (typeValue) {
                // Receipt movements - increase inventory
                case 100100000: // Receipt
                case 100100006: // Production Receipt
                case 100100009: // Purchase Receipt
                case 100100003: // Transfer-In
                case 100100010: // Return (assuming return to inventory)
                    expectedAfter = before + qty;
                    break;

                // Issue movements - decrease inventory
                case 100100001: // Issue
                case 100100007: // Production Issue
                case 100100008: // Sales Issue
                case 100100002: // Transfer-Out
                    expectedAfter = before - qty;
                    if (expectedAfter < 0 && bag) {
                        bag.push("Insufficient inventory: cannot reduce quantity below zero (Available: " + before + ")");
                        ok = false;
                    }
                    break;

                // Adjustments - can be positive or negative
                case 100100004: // Adjustment
                case 100100005: // Physical Count
                    expectedAfter = before + qty; // qty can be negative
                    break;
            }

            if (Math.abs(after - expectedAfter) > 0.001) {
                notify(fc, "Quantity After (" + after + ") does not match expected value (" + expectedAfter + ") based on movement type.", "WARNING", "pdg_sm_qty_warn");
            } else {
                clearNote(fc, "pdg_sm_qty_warn");
            }
        }

        return ok;
    };

    api.validateAuthorization = function (fc, bag) {
        // Optional: if posted, must have authorizedby
        var posted = getValue(fc, "pdg_posted");
        if (posted) {
            var auth = getValue(fc, "pdg_authorizedby");
            if (!auth) {
                if (bag) bag.push("Posted movements require 'Authorized By'.");
                return false;
            }
        }
        return true;
    };

    // --- Calculations / system fields ---
    api.updateCalculatedFields = function (fc) {
        var before = Number(getValue(fc, "pdg_quantitybefore") || 0);
        var qty = Number(getValue(fc, "pdg_quantitychanged") || 0);
        var movementType = getValue(fc, "pdg_movementtype");

        if (movementType && qty > 0) {
            var typeValue = (typeof movementType === "object" && movementType && movementType.Value !== undefined) ? movementType.Value : movementType;
            var after = before;

            switch (typeValue) {
                // Receipt/In movements - increase inventory
                case 100100000: // Receipt
                case 100100006: // Production Receipt
                case 100100009: // Purchase Receipt
                    after = before + qty;
                    break;

                // Issue/Out movements - decrease inventory  
                case 100100001: // Issue
                case 100100007: // Production Issue
                case 100100008: // Sales Issue
                    after = before - qty;
                    break;

                // Transfer Out - decrease from source
                case 100100002: // Transfer-Out
                    after = before - qty;
                    break;

                // Transfer In - increase at destination
                case 100100003: // Transfer-In
                    after = before + qty;
                    break;

                // Adjustments - can be positive or negative
                case 100100004: // Adjustment
                case 100100005: // Physical Count
                    after = before + qty; // qty can be negative for adjustments
                    break;

                // Return - context dependent, default to adding back
                case 100100010: // Return
                    after = before + qty;
                    break;

                default:
                    after = before; // No change for unknown types
                    break;
            }

            setValue(fc, "pdg_quantityafter", after);
        }
    };

    api.setSystemFields = function (fc) {
        // Set performed by to current user, if schema has it
        var userId = Xrm.Utility.getGlobalContext().userSettings.userId;
        var ctrl = getAttr(fc, "pdg_performedbyid");
        if (ctrl && userId) {
            setValue(fc, "pdg_performedbyid", [{
                id: guidClean(userId),
                entityType: "systemuser",
                name: Xrm.Utility.getGlobalContext().userSettings.userName
            }]);
        }
        // Posting date
        if (getAttr(fc, "pdg_posted") && getValue(fc, "pdg_posted") && !getValue(fc, "pdg_postingdate")) {
            setValue(fc, "pdg_postingdate", new Date());
        }
    };

    // --- System field locking ---
    api.lockSystemFields = function (fc) {
        // Lock calculated fields
        setControlDisabled(fc, "pdg_quantityafter", true); // Calculated field

        // Lock system-generated fields  
        setControlDisabled(fc, "pdg_movementnumber", true); // Auto-generated
        setControlDisabled(fc, "pdg_systemgenerated", true); // System field

        // Lock posting-related fields (controlled by business logic)
        setControlDisabled(fc, "pdg_postingdate", true); // Set when posted

        // Lock audit fields (Dataverse handles these automatically)
        setControlDisabled(fc, "createdby", true);
        setControlDisabled(fc, "createdon", true);
        setControlDisabled(fc, "modifiedby", true);
        setControlDisabled(fc, "modifiedon", true);
        setControlDisabled(fc, "createdonbehalfby", true);
        setControlDisabled(fc, "modifiedonbehalfby", true);

        // Lock currency base fields (calculated from exchange rate)
        setControlDisabled(fc, "pdg_unitcostbefore_base", true);
        setControlDisabled(fc, "pdg_unitcostafter_base", true);

        // Set performed by to current user and lock it
        var userId = Xrm.Utility.getGlobalContext().userSettings.userId;
        if (userId && !getValue(fc, "pdg_performedbyid")) {
            setValue(fc, "pdg_performedbyid", [{
                id: guidClean(userId),
                entityType: "systemuser",
                name: Xrm.Utility.getGlobalContext().userSettings.userName
            }]);
        }

        // Conditionally lock based on posted status
        api.applyPostedStatusLocks(fc);
    };

    function setControlDisabled(fc, fieldName, disabled) {
        var ctrl = getCtrl(fc, fieldName);
        if (ctrl && typeof ctrl.setDisabled === "function") {
            ctrl.setDisabled(disabled);
        }
    }

    api.applyPostedStatusLocks = function (fc) {
        var posted = getValue(fc, "pdg_posted");

        if (posted) {
            // When posted, lock most fields to prevent changes
            setControlDisabled(fc, "pdg_movementtype", true);
            setControlDisabled(fc, "pdg_itemid", true);
            setControlDisabled(fc, "pdg_warehouseid", true);
            setControlDisabled(fc, "pdg_inventoryid", true);
            setControlDisabled(fc, "pdg_quantitychanged", true);
            setControlDisabled(fc, "pdg_quantitybefore", true);
            setControlDisabled(fc, "pdg_frombinid", true);
            setControlDisabled(fc, "pdg_tobinid", true);
            setControlDisabled(fc, "pdg_reasoncode", true);

            // Set posting date when marked as posted
            if (!getValue(fc, "pdg_postingdate")) {
                setValue(fc, "pdg_postingdate", new Date());
            }

            notify(fc, "This movement has been posted and cannot be modified", "INFO", "pdg_sm_posted");
        } else {
            // When not posted, allow editing of business fields
            setControlDisabled(fc, "pdg_movementtype", false);
            setControlDisabled(fc, "pdg_itemid", false);
            setControlDisabled(fc, "pdg_warehouseid", false);
            setControlDisabled(fc, "pdg_inventoryid", false);
            setControlDisabled(fc, "pdg_quantitychanged", false);
            setControlDisabled(fc, "pdg_quantitybefore", false);
            setControlDisabled(fc, "pdg_frombinid", false);
            setControlDisabled(fc, "pdg_tobinid", false);
            setControlDisabled(fc, "pdg_reasoncode", false);

            clearNote(fc, "pdg_sm_posted");
        }
    };

    // Backwards compat wrappers used by XML events
    api.showNotification = notify;
    api.clearNotification = clearNote;

    return api;
}());