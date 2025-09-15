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

        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        this.setupFieldEvents(formContext);
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
    }
};

