/* Inventory Form - Refactored to mirror Item form helper structure */
var PDG = PDG || {};

(function () {
    // ---------- Small utilities (safe and form-agnostic) ----------
    function attr(fc, name) { try { return fc.getAttribute(name) || null; } catch (e) { return null; } }
    function ctrl(fc, name) { try { return fc.getControl(name) || null; } catch (e) { return null; } }
    function num(v) { v = (v === null || v === undefined) ? 0 : v; var n = Number(v); return isNaN(n) ? 0 : n; }
    function setIf(fc, name, val) { var a = attr(fc, name); if (a) { try { a.setValue(val); } catch (e) { } } }
    function getLookupId(v) { return v && v[0] && v[0].id ? v[0].id.replace(/[{}]/g, "") : null; }
    function notify(fc, msg, level, id) { try { fc.ui.setFormNotification(msg, level || "INFO", id || ("n_" + Date.now())); } catch (e) { } }
    function clear(fc, id) { try { fc.ui.clearFormNotification(id); } catch (e) { } }
    function now() { return new Date(); }

    PDG.Inventory = {

        // ========= Core Event Handlers =========
        onLoad: function (executionContext) {
            var formContext = executionContext.getFormContext();

            // Defaults for new records
            if (formContext.ui.getFormType() === 1) {
                this.setDefaults(formContext);
            }

            // Lock calculated/system fields
            this.lockCalculatedFields(formContext);

            // Wire dependencies & events (no unsupported addOnFocus)
            this.setupFieldDependencies(formContext);
            this.setupFieldEvents(formContext);

            // Derived values + notifications
            this.recalculateOnlineQty(formContext);
            this.checkStockLevels(formContext);

            // Snapshots
            this.loadRecentTransactions(formContext);

            // Ensure Item + Warehouse uniqueness
            this.checkItemWarehouseUniqueness({ getFormContext: function () { return formContext; } });
        },

        onSave: function (executionContext) {
            var formContext = executionContext.getFormContext();

            if (!this.validateMinMax(formContext)) {
                executionContext.getEventArgs().preventDefault();
                return false;
            }

            this.calculateTotalValue(formContext);
            return true;
        },

        // ========= Initialization / Setup =========
        setDefaults: function (formContext) {
            ["pdg_onhandquantity", "pdg_reservedquantity", "pdg_onlinequantity"].forEach(function (f) {
                var a = attr(formContext, f);
                if (a && (a.getValue() === null || a.getValue() === undefined)) a.setValue(0);
            });
            setIf(formContext, "pdg_lastupdated", now());

            // Autonumber (client fallback; let server own final)
            var invNo = attr(formContext, "pdg_inventorynumber");
            if (invNo && !invNo.getValue()) this.generateInventoryNumber(formContext);
        },

        lockCalculatedFields: function (formContext) {
            [
                "pdg_onhandquantity", "pdg_onlinequantity",
                "pdg_lastmovementdate", "pdg_lastcountdate",
                "pdg_averagecost", "pdg_fifo", "pdg_cogp",
                "pdg_weightedaveragecost", "pdg_availableforcommit"
            ].forEach(function (f) {
                var c = ctrl(formContext, f);
                if (c) c.setDisabled(true);
            });
        },

        setupFieldDependencies: function (formContext) {
            var reserved = attr(formContext, "pdg_reservedquantity");
            var item = attr(formContext, "pdg_itemid");
            var wh = attr(formContext, "pdg_warehouseid");
            var cost = attr(formContext, "pdg_costprice");
            var price = attr(formContext, "pdg_publicprice");
            var binAttr = attr(formContext, "pdg_binnumber");

            if (reserved) reserved.addOnChange(function () { PDG.Inventory.recalculateOnlineQty(formContext); });

            if (item) item.addOnChange(function () {
                PDG.Inventory.checkItemWarehouseUniqueness({ getFormContext: function () { return formContext; } });
                PDG.Inventory.loadItemSnapshot(formContext);
            });

            if (wh) wh.addOnChange(function () {
                PDG.Inventory.checkItemWarehouseUniqueness({ getFormContext: function () { return formContext; } });
                PDG.Inventory.suggestBinNumber({ getFormContext: function () { return formContext; } });
            });

            if (cost) cost.addOnChange(function () {
                PDG.Inventory.calculateTotalValue(formContext);
                PDG.Inventory.showCostingInsights(formContext);
            });

            if (price) price.addOnChange(function () {
                PDG.Inventory.showCostingInsights(formContext);
            });

            if (binAttr) binAttr.addOnChange(function () {
                var v = binAttr.getValue() || "";
                binAttr.setValue(String(v).toUpperCase());
            });
        },

        setupFieldEvents: function (formContext) {
            // If warehouse already chosen and bin is empty, suggest once on load
            try {
                var binA = attr(formContext, "pdg_binnumber");
                var whA = attr(formContext, "pdg_warehouseid");
                if (binA && !binA.getValue() && whA && whA.getValue()) {
                    this.suggestBinNumber({ getFormContext: function () { return formContext; } });
                }
            } catch (_) { }
        },

        // ========= Field Change / Derived Values =========
        recalculateOnlineQty: function (formContext) {
            var onhand = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());
            var reserved = num(attr(formContext, "pdg_reservedquantity") && attr(formContext, "pdg_reservedquantity").getValue());
            var online = Math.max(onhand - reserved, 0);
            setIf(formContext, "pdg_onlinequantity", online);
            this.checkStockLevels(formContext);
        },

        calculateTotalValue: function (formContext) {
            var cost = num(attr(formContext, "pdg_costprice") && attr(formContext, "pdg_costprice").getValue());
            var qty = num(attr(formContext, "pdg_onhandquantity") && attr(formContext, "pdg_onhandquantity").getValue());
            var total = cost * qty;
            // Field might not be on the form → safe setter
            setIf(formContext, "pdg_totalvalue", total);
        },

        validateMinMax: function (formContext) {
            var min = num(attr(formContext, "pdg_minimumstock") && attr(formContext, "pdg_minimumstock").getValue());
            var max = num(attr(formContext, "pdg_maximumstock") && attr(formContext, "pdg_maximumstock").getValue());
            if (min < 0 || max < 0 || (max && min && max < min)) {
                notify(formContext, "Minimum/Maximum stock levels are invalid.", "ERROR", "minmax");
                return false;
            }
            clear(formContext, "minmax");
            return true;
        },

        checkStockLevels: function (formContext) {
            var qty = num(attr(formContext, "pdg_onlinequantity") && attr(formContext, "pdg_onlinequantity").getValue());
            var min = num(attr(formContext, "pdg_minimumstock") && attr(formContext, "pdg_minimumstock").getValue());
            var max = num(attr(formContext, "pdg_maximumstock") && attr(formContext, "pdg_maximumstock").getValue());

            clear(formContext, "inv_stock");
            if (min && qty < min) {
                notify(formContext, "⚠️ Below minimum stock. Consider replenishment.", "WARNING", "inv_stock");
            } else if (max && qty > max) {
                notify(formContext, "ℹ️ Above maximum stock target.", "INFO", "inv_stock");
            }
        },

        // ========= Business Actions =========
        quickCount: function (formContext) {
            var onhandAttr = attr(formContext, "pdg_onhandquantity");
            if (!onhandAttr) return;

            var current = num(onhandAttr.getValue());
            Xrm.Navigation.openPrompt({ text: "Enter counted quantity", title: "Physical Count", value: String(current) })
                .then(function (res) {
                    if (!res || res.cancelled) return;
                    var counted = num(res.value);
                    onhandAttr.setValue(counted);
                    setIf(formContext, "pdg_lastcountdate", now());
                    PDG.Inventory.recalculateOnlineQty(formContext);
                    PDG.Inventory.calculateTotalValue(formContext);
                    formContext.data.save();
                });
        },

        // ========= Data Access / Server helpers =========
        loadItemSnapshot: function (formContext) {
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            var id = getLookupId(item);
            if (!id) return;

            Xrm.WebApi.retrieveRecord("pdg_inventoryitem", id, "?$select=pdg_name,pdg_sku,pdg_unitcost,pdg_publicprice,pdg_measurementunit").then(function (rec) {
                var msg = "📦 " + (rec.pdg_name || "") + (rec.pdg_sku ? " — " + rec.pdg_sku : "");
                if (rec.pdg_unitcost || rec.pdg_publicprice) {
                    msg += "\n💰 Cost: " + (rec.pdg_unitcost || 0) + " | Price: " + (rec.pdg_publicprice || 0);
                }
                notify(formContext, msg, "INFO", "item_details");
            }).catch(function (e) {
                console.warn("loadItemSnapshot:", e.message);
            });
        },

        loadRecentTransactions: function (formContext) {
            var invId = formContext.data && formContext.data.entity && formContext.data.entity.getId && formContext.data.entity.getId();
            if (!invId) return;
            invId = invId.replace(/[{}]/g, "");

            Xrm.WebApi.retrieveMultipleRecords(
                "pdg_inventorytransaction",
                "?$select=pdg_transactiondate,pdg_transactiontype,pdg_quantity,pdg_unitcost&$filter=_pdg_inventoryid_value eq " + invId + "&$orderby=pdg_transactiondate desc&$top=5"
            ).then(function (res) {
                if (!res.entities.length) return;
                var note = "🔄 Recent Movements\n";
                res.entities.forEach(function (t) {
                    var d = t.pdg_transactiondate ? new Date(t.pdg_transactiondate).toLocaleDateString() : "";
                    var type = t["pdg_transactiontype@OData.Community.Display.V1.FormattedValue"] || "";
                    note += "• " + d + " — " + type + " — Qty: " + (t.pdg_quantity || 0) + "\n";
                });
                notify(formContext, note, "INFO", "recent_txn");
            }).catch(function (e) { console.warn("loadRecentTransactions:", e); });
        },

        checkItemWarehouseUniqueness: function (executionContext) {
            var formContext = executionContext.getFormContext ? executionContext.getFormContext() : executionContext;
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            var wh = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
            if (!item || !wh) return;

            var itemId = getLookupId(item);
            var whId = getLookupId(wh);
            var currentId = (formContext.data && formContext.data.entity && formContext.data.entity.getId && formContext.data.entity.getId()) || "";

            var query = "?$select=pdg_inventoryid&$filter=_pdg_itemid_value eq " + itemId + " and _pdg_warehouseid_value eq " + whId;
            Xrm.WebApi.retrieveMultipleRecords("pdg_inventory", query).then(function (res) {
                var existing = res.entities.filter(function (e) { return e.pdg_inventoryid !== currentId; });
                if (existing.length > 0) {
                    notify(formContext, "An inventory record for this Item + Warehouse already exists.", "ERROR", "uniq");
                } else {
                    clear(formContext, "uniq");
                }
            }).catch(function (e) { console.warn("uniqueness:", e.message); });
        },

        // ========= Suggestions / Formatting =========
        suggestBinNumber: function (executionContext) {
            var formContext = executionContext.getFormContext ? executionContext.getFormContext() : executionContext;
            var wh = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
            var binA = attr(formContext, "pdg_binnumber");
            if (!wh || !binA || binA.getValue()) return;

            var whName = wh[0].name || "";
            var suggestion = (whName.substring(0, 3).toUpperCase() + "-A01");
            binA.setValue(suggestion);
        },

        generateInventoryNumber: function (formContext) {
            var item = attr(formContext, "pdg_itemid") && attr(formContext, "pdg_itemid").getValue();
            var wh = attr(formContext, "pdg_warehouseid") && attr(formContext, "pdg_warehouseid").getValue();
            var prefix = "INV";
            var sfx = (new Date()).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
            var composed = prefix + "-" + (wh ? wh[0].name.substring(0, 3).toUpperCase() : "XXX") + "-" + (item ? item[0].name.substring(0, 5).toUpperCase() : "ITEM") + "-" + sfx;
            setIf(formContext, "pdg_inventorynumber", composed);
        },

        showCostingInsights: function (formContext) {
            var cost = num(attr(formContext, "pdg_costprice") && attr(formContext, "pdg_costprice").getValue());
            var price = num(attr(formContext, "pdg_publicprice") && attr(formContext, "pdg_publicprice").getValue());
            if (!(cost > 0 && price > 0)) { clear(formContext, "cost_insights"); return; }
            var margin = ((price - cost) / price) * 100;
            var msg = "📊 Margin: " + margin.toFixed(1) + "%";
            var type = margin < 15 ? "ERROR" : (margin < 25 ? "WARNING" : "INFO");
            if (margin < 15) msg += " — Too low for comfort!";
            notify(formContext, msg, type, "cost_insights");
        }
    };
})();
