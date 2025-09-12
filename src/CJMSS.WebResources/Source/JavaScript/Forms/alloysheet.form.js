/* === PDG Alloy Sheet Form - JavaScript === */
var PDG = PDG || {};
PDG.AlloySheet = {

    // ========= Constants =========
    SHEET_STATUS: {
        DRAFT: 100000000,
        POSTED: 100000001,
        CANCELLED: 100000002
    },

    // ========= Core =========

    // Resolve formContext from executionContext or legacy Xrm.Page
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") return ctx.getFormContext();
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") return ctx;
            if (typeof Xrm !== "undefined" && Xrm.Page) return Xrm.Page;
        } catch (e) {}
        throw new Error("Form context not available. Enable 'Pass execution context'.");
    },

    onLoad: function (executionContext) {
        var formContext = PDG.AlloySheet.resolveFormContext(executionContext);
        console.log("PDG AlloySheet: Load start");

        // Defaults for new
        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.setupFieldDependencies(formContext);
        this.lockCalculatedFields(formContext);
        this.setupFieldEvents(formContext);

        // Initial calculations
        this.calculateAlloyQuantities(formContext);

        console.log("PDG AlloySheet: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.AlloySheet.resolveFormContext(executionContext);
        console.log("PDG AlloySheet: Save start");

        // Validate
        if (!this.validateAlloySheet(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        // Update derived fields before save
        this.calculateAlloyQuantities(formContext);

        console.log("PDG AlloySheet: Save done");
    },

    // ========= Initialization =========

    setDefaults: function (formContext) {
        try {
            // Today
            this.setValue(formContext, "pdg_alloydate", new Date());

            // Status
            this.setValue(formContext, "pdg_sheetstatus", this.SHEET_STATUS.DRAFT);

            // Serial: if no server autonumber, create a client fallback
            var serial = this.getValue(formContext, "pdg_serialnumber");
            if (!serial) {
                this.generateSerialNumber(formContext);
            }
        } catch (e) { console.error("Defaults error", e); }
    },

    setupFieldDependencies: function (formContext) {
        try {
            var sourceAttr = formContext.getAttribute("pdg_sourceitemid");
            if (sourceAttr) sourceAttr.addOnChange(this.onSourceItemChange.bind(this));

            var targetAttr = formContext.getAttribute("pdg_targetitemid");
            if (targetAttr) targetAttr.addOnChange(this.onTargetItemChange.bind(this));

            var statusAttr = formContext.getAttribute("pdg_sheetstatus");
            if (statusAttr) statusAttr.addOnChange(this.onStatusChange.bind(this));
        } catch (e) { console.error("Deps setup error", e); }
    },

    setupFieldEvents: function (formContext) {
        try {
            var qAttr = formContext.getAttribute("pdg_inputquantity");
            if (qAttr) qAttr.addOnChange(this.calculateAlloyQuantities.bind(this));

            var lpAttr = formContext.getAttribute("pdg_losspercentage");
            if (lpAttr) lpAttr.addOnChange(this.calculateAlloyQuantities.bind(this));
        } catch (e) { console.error("Field events error", e); }
    },

    lockCalculatedFields: function (formContext) {
        this.setDisabled(formContext, "pdg_lossquantity", true);
        this.setDisabled(formContext, "pdg_outputquantity", true);
    },

    // ========= Field Handlers =========

    onSourceItemChange: function (executionContext) {
        var formContext = PDG.AlloySheet.resolveFormContext(executionContext);
        this.ensureDifferentItems(formContext);
    },

    onTargetItemChange: function (executionContext) {
        var formContext = PDG.AlloySheet.resolveFormContext(executionContext);
        this.ensureDifferentItems(formContext);
    },

    onStatusChange: function (executionContext) {
        var formContext = PDG.AlloySheet.resolveFormContext(executionContext);
        var status = this.getValue(formContext, "pdg_sheetstatus");
        var isPosted = (status === this.SHEET_STATUS.POSTED);

        // When posted, lock key inputs
        this.setDisabled(formContext, "pdg_alloydate", isPosted);
        this.setDisabled(formContext, "pdg_warehouseid", isPosted);
        this.setDisabled(formContext, "pdg_sourceitemid", isPosted);
        this.setDisabled(formContext, "pdg_targetitemid", isPosted);
        this.setDisabled(formContext, "pdg_inputquantity", isPosted);
        this.setDisabled(formContext, "pdg_losspercentage", isPosted);
        this.setDisabled(formContext, "pdg_charges", isPosted);
        this.setDisabled(formContext, "pdg_referencenumber", isPosted);
        this.setDisabled(formContext, "pdg_remarks", isPosted);
    },

    // ========= Calculations =========

    calculateAlloyQuantities: function (formContext) {
        try {
            var qty = parseFloat(this.getValue(formContext, "pdg_inputquantity")) || 0;
            var lossPct = parseFloat(this.getValue(formContext, "pdg_losspercentage")) || 0;

            if (lossPct < 0) lossPct = 0;
            if (lossPct > 100) lossPct = 100;

            var lossQty = qty * (lossPct / 100.0);
            var outQty = qty - lossQty;

            // Round to 3 decimals typical for metal weights
            lossQty = Math.round(lossQty * 1000) / 1000;
            outQty = Math.round(outQty * 1000) / 1000;

            this.setValue(formContext, "pdg_lossquantity", lossQty);
            this.setValue(formContext, "pdg_outputquantity", outQty);
        } catch (e) { console.error("Calc error", e); }
    },

    ensureDifferentItems: function (formContext) {
        var src = this.getValue(formContext, "pdg_sourceitemid");
        var trg = this.getValue(formContext, "pdg_targetitemid");
        if (src && trg && src[0] && trg[0] && src[0].id === trg[0].id) {
            this.setNotification(formContext, "pdg_targetitemid", "Target Item must differ from Source Item", "same_item");
        } else {
            this.clearNotification(formContext, "pdg_targetitemid", "same_item");
        }
    },

    // ========= Validation =========

    validateAlloySheet: function (formContext) {
        // Clear prior notifications
        [
            "pdg_alloydate","pdg_warehouseid","pdg_sourceitemid","pdg_targetitemid",
            "pdg_inputquantity","pdg_losspercentage"
        ].forEach(function (f) { try { formContext.getControl(f) && formContext.getControl(f).clearNotification(); } catch (e) {} });

        var errors = [];

        if (!this.getValue(formContext, "pdg_alloydate")) {
            errors.push({ field: "pdg_alloydate", msg: "Alloy Date is required" });
        }

        if (!this.getValue(formContext, "pdg_warehouseid")) {
            errors.push({ field: "pdg_warehouseid", msg: "Warehouse is required" });
        }

        if (!this.getValue(formContext, "pdg_sourceitemid")) {
            errors.push({ field: "pdg_sourceitemid", msg: "Source Item is required" });
        }

        if (!this.getValue(formContext, "pdg_targetitemid")) {
            errors.push({ field: "pdg_targetitemid", msg: "Target Item is required" });
        }

        var qty = this.getValue(formContext, "pdg_inputquantity");
        if (qty === null || qty === undefined || qty <= 0) {
            errors.push({ field: "pdg_inputquantity", msg: "Input Quantity must be greater than 0" });
        }

        var lossPct = this.getValue(formContext, "pdg_losspercentage");
        if (lossPct === null || lossPct === undefined || lossPct < 0 || lossPct > 100) {
            errors.push({ field: "pdg_losspercentage", msg: "Loss % must be between 0 and 100" });
        }

        // Source and target must differ
        var src = this.getValue(formContext, "pdg_sourceitemid");
        var trg = this.getValue(formContext, "pdg_targetitemid");
        if (src && trg && src[0] && trg[0] && src[0].id === trg[0].id) {
            errors.push({ field: "pdg_targetitemid", msg: "Target Item must differ from Source Item" });
        }

        // Report
        if (errors.length > 0) {
            errors.forEach(function (e) { try { formContext.getControl(e.field).setNotification(e.msg); } catch (x) {} });
            formContext.ui.setFormNotification("Alloy Sheet validation failed", "ERROR", "alloy_validation");
            return false;
        } else {
            formContext.ui.clearFormNotification("alloy_validation");
            return true;
        }
    },

    // ========= Helpers =========

    generateSerialNumber: function (formContext) {
        /* Rely on server autonumber
        try {
            var now = new Date();
            var y = now.getFullYear().toString().slice(-2);
            var m = ("0" + (now.getMonth() + 1)).slice(-2);
            var d = ("0" + now.getDate()).slice(-2);
            var h = ("0" + now.getHours()).slice(-2);
            var n = ("0" + now.getMinutes()).slice(-2);
            var s = ("0" + now.getSeconds()).slice(-2);
            var serial = "AS-" + y + m + d + "-" + h + n + s;
            this.setValue(formContext, "pdg_serialnumber", serial);
        } catch (e) { console.warn("Serial generation failed", e); }
        */
    },

    getValue: function (formContext, fieldName) {
        var attr = formContext.getAttribute(fieldName);
        return attr ? attr.getValue() : null;
    },

    setValue: function (formContext, fieldName, value) {
        var attr = formContext.getAttribute(fieldName);
        if (attr) {
            attr.setValue(value);
            // fire onChange to cascade calc when appropriate
            try { attr.fireOnChange && attr.fireOnChange(); } catch (e) {}
        }
    },

    setDisabled: function (formContext, fieldName, disabled) {
        var ctrl = formContext.getControl(fieldName);
        if (ctrl) ctrl.setDisabled(!!disabled);
    },

    setVisible: function (formContext, fieldName, visible) {
        var ctrl = formContext.getControl(fieldName);
        if (ctrl) ctrl.setVisible(!!visible);
    },

    setNotification: function (formContext, fieldName, message, uniqueId) {
        var ctrl = formContext.getControl(fieldName);
        if (ctrl) ctrl.setNotification(message, uniqueId || null);
    },

    clearNotification: function (formContext, fieldName, uniqueId) {
        var ctrl = formContext.getControl(fieldName);
        if (ctrl) {
            if (uniqueId) ctrl.clearNotification(uniqueId);
            else ctrl.clearNotification();
        }
    }
};

// Simple event proxies for form bindings
function PDG_AlloySheet_OnLoad(executionContext) { PDG.AlloySheet.onLoad(executionContext); }
function PDG_AlloySheet_OnSave(executionContext) { PDG.AlloySheet.onSave(executionContext); }

