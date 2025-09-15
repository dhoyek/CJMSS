/* === PDG Purchase Order Receipt Form - JavaScript === */
var PDG = PDG || {};
PDG.PurchaseOrderReceipt = {
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
        var formContext = PDG.PurchaseOrderReceipt.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrderReceipt: Load start");

        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        this.setupFieldEvents(formContext);
        console.log("PDG PurchaseOrderReceipt: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.PurchaseOrderReceipt.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrderReceipt: Save start");
        if (!this.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }
        console.log("PDG PurchaseOrderReceipt: Save done");
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            // Autonumber for receipt number
            try { formContext.ui.setFormNotification("Receipt Number is generated on save", "INFO", "porec_serial_info"); } catch (x) {}
            if (!this.getValue(formContext, "pdg_receiptdate")) {
                this.setValue(formContext, "pdg_receiptdate", new Date());
            }
        } catch (e) { console.error("PO Receipt defaults error", e); }
    },

    lockCalculatedFields: function (formContext) {
        this.setDisabled(formContext, "pdg_receiptnumber", true);
    },

    setupFieldEvents: function (formContext) {
        var self = this;
        var qtyAttr = formContext.getAttribute("pdg_quantityreceived");
        qtyAttr && qtyAttr.addOnChange(function (ctx) { self.onQtyChanged(ctx); });
    },

    onQtyChanged: function (executionContext) {
        var formContext = PDG.PurchaseOrderReceipt.resolveFormContext(executionContext);
        var q = parseFloat(this.getValue(formContext, "pdg_quantityreceived") || 0);
        if (q < 0) {
            this.setValue(formContext, "pdg_quantityreceived", 0);
            try { var c=formContext.getControl("pdg_quantityreceived"); c && c.setNotification("Quantity cannot be negative."); } catch (e) {}
        } else {
            try { var c=formContext.getControl("pdg_quantityreceived"); c && c.clearNotification(); } catch (e) {}
        }
    },

    // ========= Validation =========
    validate: function (formContext) {
        ["pdg_receiptdate","pdg_quantityreceived"].forEach(function (f) { try { var c=formContext.getControl(f); c && c.clearNotification(); } catch(e){} });
        var errs = [];
        if (!this.getValue(formContext, "pdg_receiptdate")) errs.push({ field: "pdg_receiptdate", msg: "Receipt Date is required" });
        var qty = parseFloat(this.getValue(formContext, "pdg_quantityreceived") || 0);
        if (!(qty > 0)) errs.push({ field: "pdg_quantityreceived", msg: "Quantity Received must be > 0" });

        // If both lookups are present in metadata, require at least the line or header
        try {
            var hasPOLink = !!formContext.getAttribute("pdg_purchaseorderid");
            var hasLineLink = !!formContext.getAttribute("pdg_purchaseorderlineid");
            if (hasPOLink || hasLineLink) {
                var po = hasPOLink ? this.getValue(formContext, "pdg_purchaseorderid") : null;
                var line = hasLineLink ? this.getValue(formContext, "pdg_purchaseorderlineid") : null;
                if (!po && !line) {
                    var field = hasLineLink ? "pdg_purchaseorderlineid" : "pdg_purchaseorderid";
                    errs.push({ field: field, msg: "Link to PO or PO Line is required" });
                }
            }
        } catch (e) {}

        if (errs.length) {
            errs.forEach(function (e) { try { var c=formContext.getControl(e.field); c && c.setNotification(e.msg); } catch(x){} });
            formContext.ui.setFormNotification("Receipt validation failed", "ERROR", "porec_validation");
            return false;
        }
        formContext.ui.clearFormNotification("porec_validation");
        return true;
    }
};

