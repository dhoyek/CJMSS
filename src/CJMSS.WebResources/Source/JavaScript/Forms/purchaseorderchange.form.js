/* === PDG Purchase Order Change Form - JavaScript === */
var PDG = PDG || {};
PDG.PurchaseOrderChange = {
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
        var formContext = PDG.PurchaseOrderChange.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrderChange: Load start");

        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        console.log("PDG PurchaseOrderChange: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.PurchaseOrderChange.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrderChange: Save start");
        if (!this.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }
        console.log("PDG PurchaseOrderChange: Save done");
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            // Autonumber for change number
            try { formContext.ui.setFormNotification("Change Number is generated on save", "INFO", "poch_serial_info"); } catch (x) {}
            if (!this.getValue(formContext, "pdg_changedate")) {
                this.setValue(formContext, "pdg_changedate", new Date());
            }
        } catch (e) { console.error("PO Change defaults error", e); }
    },

    lockCalculatedFields: function (formContext) {
        this.setDisabled(formContext, "pdg_changenumber", true);
    },

    // ========= Validation =========
    validate: function (formContext) {
        ["pdg_entityname","pdg_fieldname","pdg_recordid"].forEach(function (f) { try { var c=formContext.getControl(f); c && c.clearNotification(); } catch(e){} });
        var errs = [];
        if (!this.getValue(formContext, "pdg_entityname")) errs.push({ field: "pdg_entityname", msg: "Entity Name is required" });
        if (!this.getValue(formContext, "pdg_fieldname")) errs.push({ field: "pdg_fieldname", msg: "Field Name is required" });
        if (!this.getValue(formContext, "pdg_recordid")) errs.push({ field: "pdg_recordid", msg: "Record Id is required" });
        if (errs.length) {
            errs.forEach(function (e) { try { var c=formContext.getControl(e.field); c && c.setNotification(e.msg); } catch(x){} });
            formContext.ui.setFormNotification("PO Change validation failed", "ERROR", "poch_validation");
            return false;
        }
        formContext.ui.clearFormNotification("poch_validation");
        return true;
    }
};

