/* === PDG Quality Control Form - JavaScript === */
var PDG = PDG || {};
PDG.QualityControl = {
    // ========= Constants =========
    INSPECTION_TYPE: {
        VISUAL: 100100000,
        DIMENSIONAL: 100100001,
        FUNCTIONAL: 100100002,
        CHEMICAL: 100100003,
        ELECTRICAL: 100100004
    },
    FREQUENCY: {
        EVERY_RECEIPT: 100100000,
        STATISTICAL_SAMPLING: 100100001,
        FIRST_ARTICLE_ONLY: 100100002,
        SKIP_LOT: 100100003
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
        var formContext = PDG.QualityControl.resolveFormContext(executionContext);
        console.log("PDG QualityControl: Load start");

        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.lockCalculatedFields(formContext);
        this.setupFieldDependencies(formContext);
        this.setupFieldEvents(formContext);
        this.refreshConditionalUI(formContext);

        console.log("PDG QualityControl: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.QualityControl.resolveFormContext(executionContext);
        console.log("PDG QualityControl: Save start");

        if (!this.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        console.log("PDG QualityControl: Save done");
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            // Default to active template
            if (this.getValue(formContext, "pdg_isactive") === null) {
                this.setValue(formContext, "pdg_isactive", true);
            }

            // Dataverse autonumber handles QC Serial; do not set on client.
            if (formContext.ui.getFormType() === 1) {
                try { formContext.ui.setFormNotification("QC Serial will be generated on save", "INFO", "qc_serial_info"); } catch (x) {}
            }

            // Reasonable defaults
            if (this.getValue(formContext, "pdg_frequency") === null) {
                this.setValue(formContext, "pdg_frequency", this.FREQUENCY.EVERY_RECEIPT);
            }
        } catch (e) { console.error("QC defaults error", e); }
    },

    lockCalculatedFields: function (formContext) {
        // Serial generally controlled by autonumbering or process
        this.setDisabled(formContext, "pdg_qcserial", true);
    },

    setupFieldDependencies: function (formContext) {
        try {
            var inspAttr = formContext.getAttribute("pdg_inspectiontype");
            if (inspAttr) inspAttr.addOnChange(this.onInspectionTypeChange.bind(this));

            var itemAttr = formContext.getAttribute("pdg_itemid");
            if (itemAttr) itemAttr.addOnChange(this.onItemChange.bind(this));
        } catch (e) { console.error("QC deps setup error", e); }
    },

    setupFieldEvents: function (formContext) {
        // No numeric calculations, but we can watch key text fields for hints
        try {
            var acAttr = formContext.getAttribute("pdg_acceptancecriteria");
            acAttr && acAttr.addOnChange(this.onCriteriaChanged.bind(this));
        } catch (e) { console.error("QC field events error", e); }
    },

    // ========= Field Handlers =========
    onInspectionTypeChange: function (executionContext) {
        var formContext = PDG.QualityControl.resolveFormContext(executionContext);
        this.refreshConditionalUI(formContext);
    },

    onItemChange: function (executionContext) {
        var formContext = PDG.QualityControl.resolveFormContext(executionContext);
        // Optional: warn if item does not require QC
        try {
            var itemRef = this.getValue(formContext, "pdg_itemid");
            if (itemRef && itemRef[0]) {
                var id = itemRef[0].id.replace(/[{}]/g, "");
                Xrm.WebApi.retrieveRecord("pdg_inventoryitem", id, "?$select=pdg_qualitycontrolrequired").then(function (rec) {
                    if (rec && rec.pdg_qualitycontrolrequired === false) {
                        formContext.ui.setFormNotification("Item does not require QC per item setup", "WARNING", "qc_item_not_required");
                    } else {
                        formContext.ui.clearFormNotification("qc_item_not_required");
                    }
                });
            }
        } catch (e) { console.warn("QC item change advisory failed", e); }
    },

    onCriteriaChanged: function (executionContext) {
        var formContext = PDG.QualityControl.resolveFormContext(executionContext);
        var txt = this.getValue(formContext, "pdg_acceptancecriteria");
        if (txt && txt.length > 1000) {
            formContext.ui.setFormNotification("Acceptance criteria is quite long. Consider linking a document.", "INFO", "qc_long_criteria");
        } else {
            formContext.ui.clearFormNotification("qc_long_criteria");
        }
    },

    // ========= UI Behavior =========
    refreshConditionalUI: function (formContext) {
        var insp = this.getValue(formContext, "pdg_inspectiontype");

        // Show/hide fields depending on inspection type
        var showSampling = (insp === this.INSPECTION_TYPE.DIMENSIONAL || insp === this.INSPECTION_TYPE.CHEMICAL);
        var showTestSpec = (insp === this.INSPECTION_TYPE.FUNCTIONAL || insp === this.INSPECTION_TYPE.ELECTRICAL || insp === this.INSPECTION_TYPE.CHEMICAL);

        this.setVisible(formContext, "pdg_samplingplan", !!showSampling);
        this.setVisible(formContext, "pdg_testspecification", !!showTestSpec);
    },

    // ========= Validation =========
    validate: function (formContext) {
        // Clear notifications
        [
            "pdg_itemid","pdg_inspectiontype"
        ].forEach(function (f) { try { var c = formContext.getControl(f); c && c.clearNotification(); } catch (e) {} });

        var errors = [];
        if (!this.getValue(formContext, "pdg_itemid")) {
            errors.push({ field: "pdg_itemid", msg: "Item is required" });
        }
        if (this.getValue(formContext, "pdg_inspectiontype") === null) {
            errors.push({ field: "pdg_inspectiontype", msg: "Inspection Type is required" });
        }

        if (errors.length) {
            errors.forEach(function (e) { try { var c = formContext.getControl(e.field); c && c.setNotification(e.msg); } catch (x) {} });
            formContext.ui.setFormNotification("Quality Control validation failed", "ERROR", "qc_validation");
            return false;
        }

        formContext.ui.clearFormNotification("qc_validation");
        return true;
    }
};
