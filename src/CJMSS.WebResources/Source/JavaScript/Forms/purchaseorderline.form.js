/* === PDG Purchase Order Line Form - JavaScript === */
var PDG = PDG || {};
PDG.PurchaseOrderLine = {
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
        var formContext = PDG.PurchaseOrderLine.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrderLine: Load start");

        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        this.setupFieldEvents(formContext);
        this.refreshConditionalUI(formContext);

        console.log("PDG PurchaseOrderLine: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.PurchaseOrderLine.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrderLine: Save start");

        if (!this.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        // Ensure totals are recalculated before save
        this.calculateLineTotals(formContext);

        console.log("PDG PurchaseOrderLine: Save done");
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            // Autonumber handles line number
            try { formContext.ui.setFormNotification("PO Line Number is generated on save", "INFO", "poline_serial_info"); } catch (x) {}
        } catch (e) { console.error("PO Line defaults error", e); }
    },

    lockCalculatedFields: function (formContext) {
        // Line totals and received qty are server/rollup driven
        ["pdg_purchaseorderline1", "pdg_linetotal", "pdg_qtyreceived", "pdg_finalunitcost"].forEach(function (f) {
            PDG.PurchaseOrderLine.setDisabled(formContext, f, true);
        });
    },

    setupFieldEvents: function (formContext) {
        var self = this;
        ["pdg_quantity", "pdg_unitprice", "pdg_discount", "pdg_extracharges"].forEach(function (f) {
            try { var a = formContext.getAttribute(f); a && a.addOnChange(self.onCalcFieldChanged.bind(self)); } catch (e) {}
        });
    },

    onCalcFieldChanged: function (executionContext) {
        var formContext = PDG.PurchaseOrderLine.resolveFormContext(executionContext);
        this.calculateLineTotals(formContext);
    },

    // ========= Calculations =========
    calculateLineTotals: function (formContext) {
        try {
            var qty = parseFloat(this.getValue(formContext, "pdg_quantity") || 0);
            var price = this.getValue(formContext, "pdg_unitprice");
            price = price && price.value ? parseFloat(price.value) : parseFloat(price || 0);
            var discPct = parseFloat(this.getValue(formContext, "pdg_discount") || 0);
            var extra = this.getValue(formContext, "pdg_extracharges");
            extra = extra && extra.value ? parseFloat(extra.value) : parseFloat(extra || 0);

            if (qty < 0) qty = 0;
            if (price < 0) price = 0;
            if (discPct < 0) discPct = 0;

            var gross = qty * price;
            var discountAmt = gross * (discPct / 100.0);
            var net = gross - discountAmt;
            var lineTotal = net + (extra || 0);

            // Set linetotal (Money)
            this.setValue(formContext, "pdg_linetotal", lineTotal);

            // Final unit cost if qty > 0
            var finalUnit = qty > 0 ? (lineTotal / qty) : 0;
            this.setValue(formContext, "pdg_finalunitcost", finalUnit);
        } catch (e) { console.error("Line total calc error", e); }
    },

    // ========= UI =========
    refreshConditionalUI: function (formContext) {
        // Read-only for serial
        this.setDisabled(formContext, "pdg_purchaseorderline1", true);
    },

    // ========= Validation =========
    validate: function (formContext) {
        ["pdg_item", "pdg_quantity", "pdg_unitprice"].forEach(function (f) { try { var c = formContext.getControl(f); c && c.clearNotification(); } catch (e) {} });
        var errors = [];
        if (!this.getValue(formContext, "pdg_item")) errors.push({ field: "pdg_item", msg: "Item is required" });
        var qty = this.getValue(formContext, "pdg_quantity");
        if (qty === null || qty === undefined || qty <= 0) errors.push({ field: "pdg_quantity", msg: "Quantity must be > 0" });
        if (!this.getValue(formContext, "pdg_unitprice")) errors.push({ field: "pdg_unitprice", msg: "Unit Price is required" });

        if (errors.length) {
            errors.forEach(function (e) { try { var c = formContext.getControl(e.field); c && c.setNotification(e.msg); } catch (x) {} });
            formContext.ui.setFormNotification("PO Line validation failed", "ERROR", "poline_validation");
            return false;
        }
        formContext.ui.clearFormNotification("poline_validation");
        return true;
    }
};

