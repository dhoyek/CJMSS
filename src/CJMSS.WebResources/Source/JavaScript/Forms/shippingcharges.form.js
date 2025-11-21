/* === PDG Shipping Charges Form - JavaScript === */
var PDG = PDG || {};
PDG.ShippingCharges = {
    // ========= Utilities =========
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") return ctx.getFormContext();
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") return ctx; // legacy
            if (typeof Xrm !== "undefined" && Xrm.Page) return Xrm.Page;
        } catch (e) {}
        throw new Error("Form context not available. Enable 'Pass execution context'.");
    },
    getValue: function (formContext, field) {
        try { var a = formContext.getAttribute(field); return a ? a.getValue() : null; } catch (e) { return null; }
    },
    setValue: function (formContext, field, value) {
        try { var a = formContext.getAttribute(field); a && a.setValue(value); } catch (e) {}
    },
    setDisabled: function (formContext, field, disabled) {
        try { var c = formContext.getControl(field); c && c.setDisabled(disabled); } catch (e) {}
    },
    setNotification: function (formContext, field, message, id) {
        try { var c = formContext.getControl(field); c && c.setNotification(message, id || null); } catch (e) {}
    },
    clearNotification: function (formContext, field, id) {
        try { var c = formContext.getControl(field); if (c) { id ? c.clearNotification(id) : c.clearNotification(); } } catch (e) {}
    },

    // ========= Core =========
    onLoad: function (executionContext) {
        var formContext = PDG.ShippingCharges.resolveFormContext(executionContext);
        console.log("PDG ShippingCharges: Load start");

        var formType = formContext.ui.getFormType();
        if (formType === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        this.setupFieldEvents(formContext);
        try { this.setupPOLineLookupFilter(formContext); } catch (e) { console.warn("ShippingCharges: lookup filter not applied", e); }
        try { this.setupCurrencyBehavior(formContext, { forceOverride: formType === 1 }); } catch (e) { console.warn("ShippingCharges: currency behavior not applied", e); }
        this.refreshConditionalUI(formContext);

        console.log("PDG ShippingCharges: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.ShippingCharges.resolveFormContext(executionContext);
        console.log("PDG ShippingCharges: Save start");

        // Recalculate before save
        this.calculateTotalCharges(formContext);

        console.log("PDG ShippingCharges: Save done");
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            // Autonumber for name/code if enabled
            try { formContext.ui.setFormNotification("Shipping Charges number is generated on save", "INFO", "ship_serial_info"); } catch (x) {}
        } catch (e) { console.error("Shipping defaults error", e); }
    },

    lockCalculatedFields: function (formContext) {
        // Serial and total are calculated
        ["pdg_shippingcharges1", "pdg_totalcharges"].forEach(function (f) {
            PDG.ShippingCharges.setDisabled(formContext, f, true);
        });
    },

    setupFieldEvents: function (formContext) {
        var self = this;
        [
            "pdg_freight","pdg_insurance","pdg_customsduties","pdg_bankcharges",
            "pdg_clearingfees","pdg_portduties","pdg_portexpenses","pdg_othercharges",
            "pdg_otherexpenses","pdg_transportation","pdg_demurragecharges"
        ].forEach(function (f) {
            try { var a = formContext.getAttribute(f); a && a.addOnChange(self.onCostComponentChanged.bind(self)); } catch (e) {}
        });

        var inheritAttr = formContext.getAttribute("pdg_inheritcurrencyfromparent");
        inheritAttr && inheritAttr.addOnChange(this.onInheritCurrencyChanged.bind(this));
        // Currency behavior listeners
        try {
            if (inheritAttr) {
                inheritAttr.addOnChange(function (ctx) {
                    var fc = PDG.ShippingCharges.resolveFormContext(ctx);
                    // When user toggles inherit flag, sync from parent once
                    PDG.ShippingCharges.setupCurrencyBehavior(fc, { forceOverride: true });
                });
            }
            var poAttr = formContext.getAttribute("pdg_purchaseorder");
            if (poAttr) {
                poAttr.addOnChange(function (ctx) {
                    var fc = PDG.ShippingCharges.resolveFormContext(ctx);
                    var inherit = PDG.ShippingCharges.getValue(fc, "pdg_inheritcurrencyfromparent") === true;
                    if (!inherit) return;
                    // When parent PO changes while inheriting, sync from new parent
                    PDG.ShippingCharges.setupCurrencyBehavior(fc, { forceOverride: true });
                });
            }
        } catch (e) {}

        // Backfill PO when a Line is selected
        try {
            var lineAttr = formContext.getAttribute("pdg_purchaseorderlineid");
            if (lineAttr) {
                lineAttr.addOnChange(function(){ PDG.ShippingCharges.backfillPOFromLine(formContext); });
            }
        } catch (e) {}
    },

    setupPOLineLookupFilter: function (formContext) {
        // If a PO Line lookup exists, filter it to the selected Purchase Order
        var poAttr = formContext.getAttribute("pdg_purchaseorder");
        var lineCtrl = formContext.getControl("pdg_purchaseorderlineid");
        if (!lineCtrl || !poAttr) return;
        var applyFilter = function () {
            try { lineCtrl.clearSearch && lineCtrl.clearSearch(); } catch (e) {}
            var poVal = poAttr.getValue();
            if (poVal && poVal[0] && poVal[0].id) {
                var id = poVal[0].id.replace(/[{}]/g, "");
                // addCustomFilter expects GUID value wrapped in braces
                var filter = "<filter type='and'><condition attribute='pdg_purchaseorderid' operator='eq' value='{" + id + "}' /></filter>";
                lineCtrl.addPreSearch(function () {
                    try { lineCtrl.addCustomFilter(filter, "pdg_purchaseorderline"); } catch (e) {}
                });
                try { PDG.ShippingCharges.enforceLineMatchesPO(formContext, id); } catch (e) {}
            }
        };
        applyFilter();
        poAttr.addOnChange(function(){ applyFilter(); });
    },

    onCostComponentChanged: function (executionContext) {
        var formContext = PDG.ShippingCharges.resolveFormContext(executionContext);
        this.calculateTotalCharges(formContext);
    },

    onInheritCurrencyChanged: function (executionContext) {
        var formContext = PDG.ShippingCharges.resolveFormContext(executionContext);
        try {
            var inherit = this.getValue(formContext, "pdg_inheritcurrencyfromparent");
            if (inherit === true) {
                formContext.ui.setFormNotification("Currency is inherited from the Purchase Order.", "INFO", "ship_currency_inherit");
            } else {
                formContext.ui.clearFormNotification("ship_currency_inherit");
            }
        } catch (e) {}
    },

    // ========= Currency Behavior =========
    setupCurrencyBehavior: function (formContext, options) {
        options = options || {};
        var forceOverride = !!options.forceOverride;
        try {
            var inherit = this.getValue(formContext, "pdg_inheritcurrencyfromparent") === true;
            var currencyAttr = formContext.getAttribute("transactioncurrencyid");
            var currencyCtrl = formContext.getControl("transactioncurrencyid");
            if (!currencyAttr || !currencyCtrl) return;

            // Always keep currency editable by the user
            try { currencyCtrl.setDisabled(false); } catch (e) {}

            if (!inherit) {
                // Not inheriting: keep whatever value is currently selected
                return;
            }

            var existing = currencyAttr.getValue();
            if (existing && !forceOverride) {
                // On load of existing records, do not override saved currency
                return;
            }

            var po = this.getValue(formContext, "pdg_purchaseorder");
            if (!po || !po[0] || !po[0].id) return;

            var id = (po[0].id || "").replace(/[{}]/g, "");
            if (!id) return;

            if (!Xrm || !Xrm.WebApi || !Xrm.WebApi.retrieveRecord) {
                console.warn("ShippingCharges: Xrm.WebApi.retrieveRecord not available; cannot sync currency from parent PO.");
                return;
            }

            Xrm.WebApi.retrieveRecord(
                "pdg_purchaseorder",
                id,
                "?$select=transactioncurrencyid&$expand=transactioncurrencyid($select=transactioncurrencyid,currencyname,isocurrencycode)"
            ).then(function (rec) {
                try {
                    var cur = rec && rec.transactioncurrencyid;
                    var curId = cur && cur.transactioncurrencyid;
                    if (!curId) return;
                    var curName = cur.currencyname || cur.isocurrencycode || "Currency";
                    currencyAttr.setValue([{
                        id: curId.replace(/[{}]/g, ""),
                        name: curName,
                        entityType: "transactioncurrency"
                    }]);
                } catch (e) {
                    console.warn("ShippingCharges: error applying currency from parent PO", e);
                }
            }).catch(function (err) {
                console.warn("ShippingCharges: error retrieving parent PO currency", err);
            });
        } catch (e) {
            console.warn("Currency behavior error", e);
        }
    },

    // ========= Calculations =========
    moneyToNumber: function (val) {
        if (val && typeof val === 'object' && val.value !== undefined) return parseFloat(val.value) || 0;
        var n = parseFloat(val); return isNaN(n) ? 0 : n;
    },
    calculateTotalCharges: function (formContext) {
        try {
            var fields = [
                "pdg_freight","pdg_insurance","pdg_customsduties","pdg_bankcharges",
                "pdg_clearingfees","pdg_portduties","pdg_portexpenses","pdg_othercharges",
                "pdg_otherexpenses","pdg_transportation","pdg_demurragecharges"
            ];
            var total = 0;
            for (var i = 0; i < fields.length; i++) {
                total += this.moneyToNumber(this.getValue(formContext, fields[i]));
            }
            this.setValue(formContext, "pdg_totalcharges", total);
        } catch (e) { console.error("Shipping total calc error", e); }
    },

    // ========= UI =========
    refreshConditionalUI: function (formContext) {
        this.setDisabled(formContext, "pdg_shippingcharges1", true);
    },

    // ========= Backfill =========
    backfillPOFromLine: function (formContext) {
        var line = this.getValue(formContext, "pdg_purchaseorderlineid");
        if (line && line[0] && line[0].id) {
            var id = line[0].id.replace(/[{}]/g, "");
            var self = this;
            Xrm.WebApi.retrieveRecord("pdg_purchaseorderline", id, "?$select=pdg_purchaseorderid&$expand=pdg_purchaseorderid($select=pdg_purchaseorderid,name)")
                .then(function (rec) {
                    var poRef = rec && rec.pdg_purchaseorderid;
                    if (poRef) {
                        formContext.getAttribute("pdg_purchaseorder").setValue([{ id: poRef.pdg_purchaseorderid, name: poRef.name || "Purchase Order", entityType: "pdg_purchaseorder" }]);
                        try { self.setupPOLineLookupFilter(formContext); } catch (e) {}
                    }
                }).catch(function(){ /* ignore */ });
        }
    },

    enforceLineMatchesPO: function (formContext, poId) {
        try {
            var line = this.getValue(formContext, "pdg_purchaseorderlineid");
            if (line && line[0] && line[0].id) {
                var lineId = line[0].id.replace(/[{}]/g, "");
                Xrm.WebApi.retrieveRecord("pdg_purchaseorderline", lineId, "?$select=pdg_purchaseorderid").then(function (rec) {
                    var ref = rec && rec.pdg_purchaseorderid && rec.pdg_purchaseorderid.id ? rec.pdg_purchaseorderid.id.replace(/[{}]/g, "") : "";
                    if (poId && ref && poId.toLowerCase() !== ref.toLowerCase()) {
                        formContext.getAttribute("pdg_purchaseorderlineid").setValue(null);
                        try { var c = formContext.getControl("pdg_purchaseorderlineid"); c && c.setNotification("Cleared: selected line does not belong to the chosen PO.", "ship_line_mismatch"); setTimeout(function(){ try { c && c.clearNotification("ship_line_mismatch"); } catch(e){} }, 4000); } catch (e) {}
                    }
                });
            }
        } catch (e) {}
    }
};
