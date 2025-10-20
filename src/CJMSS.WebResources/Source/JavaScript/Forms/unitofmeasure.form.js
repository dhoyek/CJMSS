/* === PDG Unit of Measure Form - JavaScript === */
var PDG = (typeof window !== "undefined" ? (window.PDG || (window.PDG = {})) : (typeof PDG !== "undefined" ? PDG : {}));
PDG.UOM = {
    // ========= Picklist Caches / Constants =========
    UOM_TYPE: {
        LENGTH: 100100000,
        WEIGHT: 100100001,
        VOLUME: 100100002,
        AREA: 100100003,
        COUNT: 100100004,
        TIME: 100100005
    },

    // ========= Utilities =========
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") return ctx.getFormContext();
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") return ctx; // legacy
            if (typeof Xrm !== "undefined" && Xrm && Xrm.Page) return Xrm.Page;
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
        var formContext = PDG.UOM.resolveFormContext(executionContext);
        try { console.log("PDG UOM: Load start"); } catch (e) {}

        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        this.setupFieldDependencies(formContext);
        this.setupFieldEvents(formContext);
        this.refreshUIForBaseToggle(formContext);

        try { console.log("PDG UOM: Load done"); } catch (e) {}
    },

    onSave: function (executionContext) {
        var formContext = PDG.UOM.resolveFormContext(executionContext);
        try { console.log("PDG UOM: Save start"); } catch (e) {}

        if (!this.validate(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        try { console.log("PDG UOM: Save done"); } catch (e) {}
        return true;
    },

    // ========= Initialization =========
    setDefaults: function (formContext) {
        try {
            if (this.getValue(formContext, "pdg_isactive") === null) {
                this.setValue(formContext, "pdg_isactive", true);
            }
            if (this.getValue(formContext, "pdg_decimalprecision") === null) {
                this.setValue(formContext, "pdg_decimalprecision", 3);
            }
            if (this.getValue(formContext, "pdg_baseunit") === null) {
                // Default to non-base to encourage explicit base choice
                this.setValue(formContext, "pdg_baseunit", false);
            }
            if (this.getValue(formContext, "pdg_conversionfactor") === null) {
                this.setValue(formContext, "pdg_conversionfactor", 1);
            }
        } catch (e) { console.error("UOM defaults error", e); }
    },

    setupFieldDependencies: function (formContext) {
        try {
            var baseAttr = formContext.getAttribute("pdg_baseunit");
            baseAttr && baseAttr.addOnChange(this.onBaseUnitChange.bind(this));

            var baseUomAttr = formContext.getAttribute("pdg_baseuom");
            baseUomAttr && baseUomAttr.addOnChange(this.onBaseUOMChange.bind(this));

            var typeAttr = formContext.getAttribute("pdg_uomtype");
            typeAttr && typeAttr.addOnChange(this.onUOMTypeChange.bind(this));
        } catch (e) { console.error("UOM deps setup error", e); }
    },

    setupFieldEvents: function (formContext) {
        try {
            var convAttr = formContext.getAttribute("pdg_conversionfactor");
            convAttr && convAttr.addOnChange(this.onConversionFactorChange.bind(this));

            var precAttr = formContext.getAttribute("pdg_decimalprecision");
            precAttr && precAttr.addOnChange(this.onDecimalPrecisionChange.bind(this));
        } catch (e) { console.error("UOM field events error", e); }
    },

    // ========= Field Handlers =========
    onBaseUnitChange: function (executionContext) {
        var formContext = PDG.UOM.resolveFormContext(executionContext);
        this.refreshUIForBaseToggle(formContext);
    },

    onBaseUOMChange: function (executionContext) {
        var formContext = PDG.UOM.resolveFormContext(executionContext);
        var baseRef = this.getValue(formContext, "pdg_baseuom");
        if (!baseRef || !baseRef[0]) {
            formContext._PDG_BaseUOMTypeMismatch = false;
            this.clearNotification(formContext, "pdg_baseuom");
            formContext.ui && formContext.ui.clearFormNotification && formContext.ui.clearFormNotification("uom_base_mismatch");
            return;
        }
        // Validate base UOM type matches current UOM type
        try {
            if (typeof Xrm === "undefined" || !Xrm || !Xrm.WebApi) { return; }
            var id = baseRef[0].id.replace(/[{}]/g, "");
            Xrm.WebApi.retrieveRecord("pdg_unitofmeasure", id, "?$select=pdg_uomtype").then(function (rec) {
                var currentType = PDG.UOM.getValue(formContext, "pdg_uomtype");
                if (currentType !== null && rec && typeof rec.pdg_uomtype !== "undefined" && rec.pdg_uomtype !== currentType) {
                    PDG.UOM.setNotification(formContext, "pdg_baseuom", "Base UOM must have the same UOM Type", "uom_type_mismatch");
                    try { formContext.ui.setFormNotification("Base UOM must have the same UOM Type", "ERROR", "uom_base_mismatch"); } catch (e) {}
                    formContext._PDG_BaseUOMTypeMismatch = true;
                } else {
                    PDG.UOM.clearNotification(formContext, "pdg_baseuom", "uom_type_mismatch");
                    try { formContext.ui.clearFormNotification("uom_base_mismatch"); } catch (e) {}
                    formContext._PDG_BaseUOMTypeMismatch = false;
                }
            }).catch(function () {
                // If cannot retrieve, do not block but warn
                try { formContext.ui.setFormNotification("Could not verify Base UOM type", "WARNING", "uom_base_checkwarn"); } catch (e) {}
            });
        } catch (e) { console.warn("UOM base fetch error", e); }
    },

    onUOMTypeChange: function (executionContext) {
        var formContext = PDG.UOM.resolveFormContext(executionContext);
        // Re-validate base UOM type if selected
        this.onBaseUOMChange(formContext);
    },

    onConversionFactorChange: function (executionContext) {
        var formContext = PDG.UOM.resolveFormContext(executionContext);
        var val = this.getValue(formContext, "pdg_conversionfactor");
        this.clearNotification(formContext, "pdg_conversionfactor");
        if (val === null || val === undefined) return;
        if (typeof val !== "number" || isNaN(val) || val <= 0) {
            this.setNotification(formContext, "pdg_conversionfactor", "Conversion Factor must be a positive number");
        }
        var isBase = !!this.getValue(formContext, "pdg_baseunit");
        if (isBase && val !== 1) {
            this.setNotification(formContext, "pdg_conversionfactor", "Base unit must have Conversion Factor = 1");
        }
    },

    onDecimalPrecisionChange: function (executionContext) {
        var formContext = PDG.UOM.resolveFormContext(executionContext);
        var p = this.getValue(formContext, "pdg_decimalprecision");
        this.clearNotification(formContext, "pdg_decimalprecision");
        if (p === null || p === undefined) return;
        if (p < 0 || p > 6) {
            this.setNotification(formContext, "pdg_decimalprecision", "Decimal Precision must be between 0 and 6");
        }
    },

    // ========= UI Behavior =========
    refreshUIForBaseToggle: function (formContext) {
        var isBase = !!this.getValue(formContext, "pdg_baseunit");
        this.setDisabled(formContext, "pdg_baseuom", isBase);
        this.setDisabled(formContext, "pdg_conversionfactor", isBase);
        if (isBase) {
            this.setValue(formContext, "pdg_baseuom", null);
            this.setValue(formContext, "pdg_conversionfactor", 1);
            this.clearNotification(formContext, "pdg_baseuom");
            this.clearNotification(formContext, "pdg_conversionfactor");
        }
    },

    // ========= Validation =========
    validate: function (formContext) {
        // Clear existing notifications
        [
            "pdg_uomcode", "pdg_uomname", "pdg_uomtype",
            "pdg_baseuom", "pdg_conversionfactor", "pdg_decimalprecision"
        ].forEach(function (f) { try { var c = formContext.getControl(f); c && c.clearNotification(); } catch (e) {} });

        var errors = [];

        if (!this.getValue(formContext, "pdg_uomcode")) {
            errors.push({ field: "pdg_uomcode", msg: "UOM Code is required" });
        }
        if (!this.getValue(formContext, "pdg_uomname")) {
            errors.push({ field: "pdg_uomname", msg: "UOM Name is required" });
        }
        if (this.getValue(formContext, "pdg_uomtype") === null) {
            errors.push({ field: "pdg_uomtype", msg: "UOM Type is required" });
        }

        var isBase = !!this.getValue(formContext, "pdg_baseunit");
        var conv = this.getValue(formContext, "pdg_conversionfactor");
        var prec = this.getValue(formContext, "pdg_decimalprecision");

        if (!isBase) {
            if (!this.getValue(formContext, "pdg_baseuom")) {
                errors.push({ field: "pdg_baseuom", msg: "Base UOM is required for non-base units" });
            }
            if (conv === null || conv === undefined || conv <= 0) {
                errors.push({ field: "pdg_conversionfactor", msg: "Conversion Factor must be > 0" });
            }
        } else {
            if (conv !== 1) {
                errors.push({ field: "pdg_conversionfactor", msg: "Base unit must have Conversion Factor = 1" });
            }
        }

        if (prec !== null && (prec < 0 || prec > 6)) {
            errors.push({ field: "pdg_decimalprecision", msg: "Decimal Precision must be between 0 and 6" });
        }

        if (formContext._PDG_BaseUOMTypeMismatch) {
            errors.push({ field: "pdg_baseuom", msg: "Base UOM must have the same UOM Type" });
        }

        if (errors.length) {
            errors.forEach(function (e) { try { var c = formContext.getControl(e.field); c && c.setNotification(e.msg); } catch (x) {} });
            try { formContext.ui.setFormNotification("Unit of Measure validation failed", "ERROR", "uom_validation"); } catch (e) {}
            return false;
        }

        try { formContext.ui.clearFormNotification("uom_validation"); } catch (e) {}
        return true;
    }
};
