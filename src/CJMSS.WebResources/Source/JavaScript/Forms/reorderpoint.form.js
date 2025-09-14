/* === PDG Reorder Point Form - JavaScript === */
var PDG = PDG || {};
PDG.ReorderPoint = {
    // ========= Utilities =========
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") return ctx.getFormContext();
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") return ctx;
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
    setVisible: function (formContext, field, visible) {
        try { var c = formContext.getControl(field); c && c.setVisible(visible); } catch (e) {}
    },

    // ========= Core =========
    onLoad: function (executionContext) {
        var formContext = PDG.ReorderPoint.resolveFormContext(executionContext);
        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        this.setupFieldEvents(formContext);
        this.refreshConditionalUI(formContext);
        this.updateSuggestedReorderPoint(formContext);
    },

    onSave: function (executionContext) {
        var formContext = PDG.ReorderPoint.resolveFormContext(executionContext);
        if (!this.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            // Default active
            var isActive = this.getValue(formContext, "pdg_isactive");
            if (isActive === null || isActive === undefined) this.setValue(formContext, "pdg_isactive", true);

            // Autonumber handled by Dataverse
            try { formContext.ui.setFormNotification("Reorder Point Serial will be generated on save", "INFO", "rop_serial_info"); } catch (e) {}

            // Set next review date +30 days if empty
            if (!this.getValue(formContext, "pdg_nextreviewdate")) {
                var d = new Date(); d.setDate(d.getDate() + 30);
                this.setValue(formContext, "pdg_nextreviewdate", d);
            }
        } catch (e) { console.error("ROP defaults error", e); }
    },

    lockCalculatedFields: function (formContext) {
        this.setDisabled(formContext, "pdg_reorderpointserial", true);
    },

    setupFieldEvents: function (formContext) {
        var self = this;
        [
            "pdg_averagedemand", "pdg_leadtime", "pdg_safetystock"
        ].forEach(function (f) {
            var a = formContext.getAttribute(f);
            if (a) a.addOnChange(function () { self.updateSuggestedReorderPoint(formContext); });
        });

        var auto = formContext.getAttribute("pdg_autocreatepurchase");
        if (auto) auto.addOnChange(function () { self.refreshConditionalUI(formContext); });
    },

    // ========= UI Behavior =========
    refreshConditionalUI: function (formContext) {
        var auto = !!this.getValue(formContext, "pdg_autocreatepurchase");
        this.setVisible(formContext, "pdg_preferredsupplierid", auto);
    },

    updateSuggestedReorderPoint: function (formContext) {
        try {
            var avg = parseFloat(this.getValue(formContext, "pdg_averagedemand")) || 0;
            var lead = parseInt(this.getValue(formContext, "pdg_leadtime"), 10) || 0;
            var ss = parseFloat(this.getValue(formContext, "pdg_safetystock")) || 0;

            if (avg >= 0 && lead >= 0 && ss >= 0) {
                var suggested = (avg * lead) + ss;
                // Simple rounding to 3 decimals
                suggested = Math.round(suggested * 1000) / 1000;

                // If no value set, propose it
                var current = this.getValue(formContext, "pdg_reorderpoint");
                if (current === null || current === undefined) {
                    this.setValue(formContext, "pdg_reorderpoint", suggested);
                }

                // Informational tip
                try {
                    formContext.ui.setFormNotification("Suggested Reorder Point based on demand, lead time, and safety stock: " + suggested, "INFO", "rop_suggested");
                } catch (e) {}
            }
        } catch (e) { console.warn("ROP suggestion error", e); }
    },

    // ========= Validation =========
    validate: function (formContext) {
        [
            "pdg_itemid","pdg_warehouseid","pdg_reorderpoint","pdg_reorderquantity",
            "pdg_averagedemand","pdg_leadtime","pdg_maximumstock"
        ].forEach(function (f) { try { var c = formContext.getControl(f); c && c.clearNotification(); } catch (e) {} });

        var errors = [];
        if (!this.getValue(formContext, "pdg_itemid")) errors.push({ field: "pdg_itemid", msg: "Item is required" });
        if (!this.getValue(formContext, "pdg_warehouseid")) errors.push({ field: "pdg_warehouseid", msg: "Warehouse is required" });

        var rp = this.getValue(formContext, "pdg_reorderpoint");
        if (rp === null || rp === undefined || rp < 0) errors.push({ field: "pdg_reorderpoint", msg: "Reorder Point must be >= 0" });

        var rq = this.getValue(formContext, "pdg_reorderquantity");
        if (rq === null || rq === undefined || rq <= 0) errors.push({ field: "pdg_reorderquantity", msg: "Reorder Quantity must be > 0" });

        var lead = this.getValue(formContext, "pdg_leadtime");
        if (lead !== null && lead !== undefined && lead < 0) errors.push({ field: "pdg_leadtime", msg: "Lead Time cannot be negative" });

        var maxStock = this.getValue(formContext, "pdg_maximumstock");
        if (maxStock !== null && maxStock !== undefined && rp !== null && rp !== undefined && rp > maxStock) {
            errors.push({ field: "pdg_reorderpoint", msg: "Reorder Point cannot exceed Maximum Stock" });
        }

        if (errors.length) {
            errors.forEach(function (e) { try { var c = formContext.getControl(e.field); c && c.setNotification(e.msg); } catch (x) {} });
            try { formContext.ui.setFormNotification("Reorder Point validation failed", "ERROR", "rop_validation"); } catch (e) {}
            return false;
        }
        try { formContext.ui.clearFormNotification("rop_validation"); } catch (e) {}
        return true;
    }
};

