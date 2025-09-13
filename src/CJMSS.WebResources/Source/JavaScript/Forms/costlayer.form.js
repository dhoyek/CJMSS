/* === PDG Cost Layer Form (Structured like item.form.js) === */
var PDG = PDG || {};

PDG.CostLayer = {
    // ========= Constants =========
    COSTING_METHOD: {
        STANDARD: 100000000,
        AVERAGE: 100000001, // Moving Average
        FIFO: 100000002,
        LIFO: 100000003,
        ACTUAL: 100000004
    },
    // ========= Core Event Handlers =========

    // Return a formContext from executionContext or direct formContext
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") return ctx.getFormContext();
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") return ctx;
            if (typeof Xrm !== "undefined" && Xrm.Page) return Xrm.Page;
        } catch (e) { /* ignore */ }
        throw new Error("Form context not available. Enable 'Pass execution context'.");
    },

    onLoad: function (executionContext) {
        var formContext = PDG.CostLayer.resolveFormContext(executionContext);

        // Defaults for new records
        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        // Lock system/derived fields
        this.lockSystemFields(formContext);

        // Setup field dependencies and events
        this.setupFieldEvents(formContext);

        // Apply initial filters
        this.applyInventoryFilter(formContext);
    },

    onSave: function (executionContext) {
        var formContext = PDG.CostLayer.resolveFormContext(executionContext);
        var args = executionContext.getEventArgs();

        if (!this.validateForm(formContext)) {
            args.preventDefault();
            return false;
        }

        // Keep quantity remaining locked to original on create
        try { this.syncRemainingWithOriginal(formContext); } catch (e) {}

        return true;
    },

    // ========= Initialization =========

    setDefaults: function (formContext) {
        try {
            // Receipt Date: today
            this.setValue(formContext, "pdg_receiptdate", new Date());

            // Serial number is handled by Dataverse Autonumber / server-side logic

            // Default currency to USD if empty (align with item.form.js behavior)
            var currencyAttr = formContext.getAttribute("transactioncurrencyid");
            if (currencyAttr && !currencyAttr.getValue()) {
                Xrm.WebApi.retrieveMultipleRecords(
                    "transactioncurrency",
                    "?$select=transactioncurrencyid,currencyname&$filter=isocurrencycode eq 'USD'"
                ).then(function (result) {
                    if (result.entities && result.entities.length > 0) {
                        var c = result.entities[0];
                        currencyAttr.setValue([{ id: c.transactioncurrencyid, name: c.currencyname, entityType: "transactioncurrency" }]);
                    }
                }).catch(function (e) { console.warn("Default currency lookup failed:", e); });
            }

            // Initialize remaining = original when creating
            this.syncRemainingWithOriginal(formContext);
        } catch (e) {
            console.warn("CostLayer.setDefaults error:", e);
        }
    },

    lockSystemFields: function (formContext) {
        // Quantity Remaining is system-maintained by server logic; keep read-only
        var ctrl = formContext.getControl("pdg_quantityremaining");
        if (ctrl) ctrl.setDisabled(true);
    },

    setupFieldEvents: function (formContext) {
        var self = this;

        // Keep remaining aligned on create or when empty
        var oq = formContext.getAttribute("pdg_originalquantity");
        if (oq) {
            oq.addOnChange(function () { self.syncRemainingWithOriginal(formContext); });
        }

        // Filter inventory by selected item
        var item = formContext.getAttribute("pdg_itemid");
        if (item) {
            item.addOnChange(function () {
                self.applyInventoryFilter(formContext);
                self.tryDefaultUnitCost(formContext);
            });
        }

        // Guardrail validations
        var unitcost = formContext.getAttribute("pdg_unitcost");
        if (unitcost) unitcost.addOnChange(function () { self.validateUnitCost(formContext); self.updateEstimatedTotal(formContext); });
        if (oq) oq.addOnChange(function () { self.validateQuantities(formContext); self.updateEstimatedTotal(formContext); });
        var rq = formContext.getAttribute("pdg_quantityremaining");
        if (rq) rq.addOnChange(function () { self.validateQuantities(formContext); });

        // When inventory changes, also attempt a default for unit cost
        var inv = formContext.getAttribute("pdg_inventoryid");
        if (inv) inv.addOnChange(function () { self.tryDefaultUnitCost(formContext); });

        // Initial compute
        this.updateEstimatedTotal(formContext);
    },

    // ========= Helpers =========

    setValue: function (formContext, attr, value) {
        var a = formContext.getAttribute(attr);
        if (a) a.setValue(value);
    },

    getValue: function (formContext, attr) {
        var a = formContext.getAttribute(attr);
        return a ? a.getValue() : null;
    },

    syncRemainingWithOriginal: function (formContext) {
        try {
            var type = formContext.ui.getFormType();
            var orig = this.getValue(formContext, "pdg_originalquantity") || 0;
            var remAttr = formContext.getAttribute("pdg_quantityremaining");
            var remVal = remAttr ? remAttr.getValue() : null;

            // If new record or remaining is null/zero, align to original
            if (remAttr && (type === 1 || remVal === null || remVal === undefined || remVal === 0)) {
                remAttr.setValue(orig || 0);
            }
        } catch (e) {
            console.warn("syncRemainingWithOriginal error:", e);
        }
    },

    applyInventoryFilter: function (formContext) {
        try {
            var invCtrl = formContext.getControl("pdg_inventoryid");
            if (!invCtrl || typeof invCtrl.addPreSearch !== "function") return;
            // Clear previous presearch by re-adding (platform handles multiple safely)
            var self = this;
            invCtrl.addPreSearch(function () { self._addInventoryFilter(formContext, invCtrl); });
        } catch (e) {
            console.warn("applyInventoryFilter error:", e);
        }
    },

    _addInventoryFilter: function (formContext, invCtrl) {
        try {
            var itemVal = this.getValue(formContext, "pdg_itemid");
            if (!itemVal || !itemVal.length) return;
            var itemId = itemVal[0].id.replace(/[{}]/g, "");
            var filter = "<filter type='and'>" +
                "<condition attribute='pdg_itemid' operator='eq' value='" + itemId + "' />" +
                "</filter>";
            invCtrl.addCustomFilter(filter, "pdg_inventory");
        } catch (e) {
            console.warn("_addInventoryFilter error:", e);
        }
    },

    tryDefaultUnitCost: function (formContext) {
        try {
            var unitAttr = formContext.getAttribute("pdg_unitcost");
            if (!unitAttr) return;
            var current = unitAttr.getValue();
            if (current !== null && current !== undefined && current !== "") return; // respect user input

            var itemVal = this.getValue(formContext, "pdg_itemid");
            var invVal = this.getValue(formContext, "pdg_inventoryid");
            if (!itemVal || !itemVal.length || !invVal || !invVal.length) return;

            var itemId = itemVal[0].id.replace(/[{}]/g, "");
            var invId = invVal[0].id.replace(/[{}]/g, "");
            var self = this;

            // Fetch item costing method
            Xrm.WebApi.retrieveRecord("pdg_inventoryitem", itemId, "?$select=pdg_costingmethod").then(function (item) {
                var method = item && typeof item.pdg_costingmethod === "number" ? item.pdg_costingmethod : null;
                // Fetch inventory costs
                return Xrm.WebApi.retrieveRecord("pdg_inventory", invId, "?$select=pdg_weightedaveragecost,pdg_averagecost,pdg_standardcost,pdg_lastcost").then(function (inv) {
                    var wavg = inv.pdg_weightedaveragecost || 0; // numbers
                    var avg = inv.pdg_averagecost || 0;
                    var std = inv.pdg_standardcost || 0;
                    var last = inv.pdg_lastcost || 0;

                    var pick = 0;
                    if (method === self.COSTING_METHOD.STANDARD) {
                        pick = std || wavg || avg || last || 0;
                    } else if (method === self.COSTING_METHOD.AVERAGE) {
                        pick = wavg || avg || last || std || 0;
                    } else if (method === self.COSTING_METHOD.FIFO || method === self.COSTING_METHOD.LIFO || method === self.COSTING_METHOD.ACTUAL) {
                        // For layer creation, actual receipt cost should be entered; fall back to last/avg only as a hint
                        pick = last || wavg || avg || std || 0;
                    } else {
                        pick = wavg || avg || last || std || 0;
                    }

                    if (pick > 0) {
                        unitAttr.setValue(pick);
                        self.updateEstimatedTotal(formContext);
                    }
                });
            }).catch(function (e) {
                console.warn("tryDefaultUnitCost error:", e && e.message ? e.message : e);
            });
        } catch (e) {
            console.warn("tryDefaultUnitCost error (outer):", e);
        }
    },

    updateEstimatedTotal: function (formContext) {
        try {
            var qty = this.getValue(formContext, "pdg_originalquantity") || 0;
            var cost = this.getValue(formContext, "pdg_unitcost");
            var unit = (cost && cost.value !== undefined) ? cost.value : cost;
            var total = (qty || 0) * (unit || 0);
            if (total > 0) {
                formContext.ui.setFormNotification("Estimated layer value: " + total.toFixed(2), "INFO", "est_total");
            } else {
                formContext.ui.clearFormNotification("est_total");
            }
        } catch (e) {
            // non-blocking
        }
    },

    validateForm: function (formContext) {
        var ok = true;
        // Required refs
        var requiredRefs = ["pdg_itemid", "pdg_inventoryid", "pdg_receiptdate"]; // serial generated server-side
        for (var i = 0; i < requiredRefs.length; i++) {
            var a = formContext.getAttribute(requiredRefs[i]);
            var v = a ? a.getValue() : null;
            if (!v || (Array.isArray(v) && v.length === 0)) {
                this._notify(formContext, "missing_" + requiredRefs[i], "Please complete required field: " + requiredRefs[i]);
                ok = false;
            } else {
                formContext.ui.clearFormNotification("missing_" + requiredRefs[i]);
            }
        }

        if (!this.validateQuantities(formContext)) ok = false;
        if (!this.validateUnitCost(formContext)) ok = false;

        return ok;
    },

    validateQuantities: function (formContext) {
        try {
            var o = this.getValue(formContext, "pdg_originalquantity") || 0;
            var r = this.getValue(formContext, "pdg_quantityremaining");
            r = (r === null || r === undefined) ? 0 : r;
            if (o < 0) {
                this._notify(formContext, "qty_original_negative", "Original quantity cannot be negative.");
                return false;
            } else {
                formContext.ui.clearFormNotification("qty_original_negative");
            }
            if (r < 0) {
                this._notify(formContext, "qty_remaining_negative", "Remaining quantity cannot be negative.");
                return false;
            } else {
                formContext.ui.clearFormNotification("qty_remaining_negative");
            }
            if (r > o) {
                this._notify(formContext, "qty_remaining_gt_original", "Remaining quantity cannot exceed original.");
                return false;
            } else {
                formContext.ui.clearFormNotification("qty_remaining_gt_original");
            }
            return true;
        } catch (e) {
            console.warn("validateQuantities error:", e);
            return true;
        }
    },

    validateUnitCost: function (formContext) {
        try {
            var c = this.getValue(formContext, "pdg_unitcost");
            var val = (c && c.value !== undefined) ? c.value : c; // handle money or raw
            if (val === null || val === undefined) return true;
            if (val < 0) {
                this._notify(formContext, "unitcost_negative", "Unit cost cannot be negative.");
                return false;
            } else {
                formContext.ui.clearFormNotification("unitcost_negative");
                return true;
            }
        } catch (e) {
            console.warn("validateUnitCost error:", e);
            return true;
        }
    },

    _notify: function (formContext, id, msg) {
        formContext.ui.setFormNotification(msg, "ERROR", id);
    }
};
