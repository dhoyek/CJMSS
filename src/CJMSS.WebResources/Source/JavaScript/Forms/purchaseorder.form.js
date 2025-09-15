/* === PDG Purchase Order Form - JavaScript === */
var PDG = PDG || {};
PDG.PurchaseOrder = {
    // ========= Constants =========
    ORDER_STATUS: {
        DRAFT: 890590000,
        SUBMITTED: 890590001,
        APPROVED: 890590002,
        PARTIALLY_RECEIVED: 890590003,
        RECEIVED: 890590004,
        CLOSED: 890590005
    },
    PAYMENT_TERMS: {
        NET_0: 100100000,
        NET_15: 100100001,
        NET_30: 100100002,
        NET_45: 100100003,
        NET_60: 100100004,
        COD: 100100005,
        ADVANCE: 100200006
    },

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
    setVisible: function (formContext, field, visible) {
        try { var c = formContext.getControl(field); c && c.setVisible(visible); } catch (e) {}
    },
    setNotification: function (formContext, field, message, id) {
        try { var c = formContext.getControl(field); c && c.setNotification(message, id || null); } catch (e) {}
    },
    clearNotification: function (formContext, field, id) {
        try { var c = formContext.getControl(field); if (c) { id ? c.clearNotification(id) : c.clearNotification(); } } catch (e) {}
    },

    // ========= Core =========
    onLoad: function (executionContext) {
        var formContext = PDG.PurchaseOrder.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrder: Load start");

        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        this.setupFieldDependencies(formContext);
        this.setupFieldEvents(formContext);
        this.refreshConditionalUI(formContext);

        console.log("PDG PurchaseOrder: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.PurchaseOrder.resolveFormContext(executionContext);
        console.log("PDG PurchaseOrder: Save start");

        if (!this.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        console.log("PDG PurchaseOrder: Save done");
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            // Autonumber handles PONumber; provide info only
            try { formContext.ui.setFormNotification("Purchase Number is generated on save", "INFO", "po_serial_info"); } catch (x) {}

            // Default Purchase Date to today if empty
            if (!this.getValue(formContext, "pdg_deliverydate")) {
                this.setValue(formContext, "pdg_deliverydate", new Date());
            }

            // Default Payment Terms if empty
            if (this.getValue(formContext, "pdg_paymentterms") === null) {
                this.setValue(formContext, "pdg_paymentterms", this.PAYMENT_TERMS.NET_30);
            }

            // Default Buyer to current user if empty
            var buyer = this.getValue(formContext, "pdg_buyerid");
            if (!buyer) {
                try {
                    var user = Xrm.Utility.getGlobalContext().userSettings;
                    if (user && user.userId) {
                        this.setValue(formContext, "pdg_buyerid", [{ id: user.userId.replace(/[{}]/g, ''), name: user.userName, entityType: "systemuser" }]);
                    }
                } catch (e) { console.warn("Could not set default buyer", e); }
            }
        } catch (e) { console.error("PO defaults error", e); }
    },

    lockCalculatedFields: function (formContext) {
        // Header numbers and totals are calculated/rollup or server-driven
        [
            "pdg_ponumber",
            "pdg_grandtotal",
            "pdg_shippingchargestotal",
            "pdg_originalpoamount",
            "pdg_lastprintdate",
            "pdg_printcount"
        ].forEach(function (f) { PDG.PurchaseOrder.setDisabled(formContext, f, true); });
    },

    setupFieldDependencies: function (formContext) {
        try {
            var supplierAttr = formContext.getAttribute("pdg_supplier");
            supplierAttr && supplierAttr.addOnChange(this.onSupplierChange.bind(this));

            var actionDraft = formContext.getAttribute("pdg_actiondraft");
            actionDraft && actionDraft.addOnChange(this.onActionChange.bind(this));
            var actionApproval = formContext.getAttribute("pdg_actionapproval");
            actionApproval && actionApproval.addOnChange(this.onActionChange.bind(this));
            var actionFulfillment = formContext.getAttribute("pdg_actionfulfillment");
            actionFulfillment && actionFulfillment.addOnChange(this.onActionChange.bind(this));
        } catch (e) { console.error("PO deps setup error", e); }
    },

    setupFieldEvents: function (formContext) {
        // Keep header warnings/context timely
        try {
            var exp = formContext.getAttribute("pdg_expecteddeliverydate");
            exp && exp.addOnChange(this.onExpectedDateChange.bind(this));
        } catch (e) { console.error("PO field events error", e); }
    },

    // ========= Field Handlers =========
    onSupplierChange: function (executionContext) {
        var formContext = PDG.PurchaseOrder.resolveFormContext(executionContext);
        // No-op for now; placeholder for vendor-specific defaults
        try {
            var sup = this.getValue(formContext, "pdg_supplier");
            if (!sup) return;
            formContext.ui.clearFormNotification("po_vendor_note");
        } catch (e) { console.warn("PO supplier change advisory failed", e); }
    },

    onActionChange: function (executionContext) {
        var formContext = PDG.PurchaseOrder.resolveFormContext(executionContext);
        try {
            formContext.ui.setFormNotification("Save the record to apply action.", "INFO", "po_action_info");
            setTimeout(function(){ try { formContext.ui.clearFormNotification("po_action_info"); } catch (e) {} }, 4000);
        } catch (e) {}
    },

    onExpectedDateChange: function (executionContext) {
        var formContext = PDG.PurchaseOrder.resolveFormContext(executionContext);
        var dt = this.getValue(formContext, "pdg_expecteddeliverydate");
        if (dt && dt < new Date()) {
            formContext.ui.setFormNotification("Expected delivery date is in the past.", "WARNING", "po_eta_past");
        } else {
            formContext.ui.clearFormNotification("po_eta_past");
        }
    },

    // ========= UI Behavior =========
    refreshConditionalUI: function (formContext) {
        // Keep serial read-only
        this.setDisabled(formContext, "pdg_ponumber", true);
    },

    // ========= Validation =========
    validate: function (formContext) {
        // Clear notifications
        ["pdg_supplier","pdg_deliverydate"].forEach(function (f) { try { var c = formContext.getControl(f); c && c.clearNotification(); } catch (e) {} });

        var errors = [];
        if (!this.getValue(formContext, "pdg_supplier")) {
            errors.push({ field: "pdg_supplier", msg: "Supplier is required" });
        }
        if (!this.getValue(formContext, "pdg_deliverydate")) {
            errors.push({ field: "pdg_deliverydate", msg: "Purchase Date is required" });
        }

        if (errors.length) {
            errors.forEach(function (e) { try { var c = formContext.getControl(e.field); c && c.setNotification(e.msg); } catch (x) {} });
            formContext.ui.setFormNotification("Purchase Order validation failed", "ERROR", "po_validation");
            return false;
        }

        formContext.ui.clearFormNotification("po_validation");
        return true;
    }
};

