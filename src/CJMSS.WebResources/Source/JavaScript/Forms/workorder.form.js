/* === PDG Work Order Form - JavaScript === */
var PDG = PDG || {};
PDG.WorkOrder = {

    // ========= Constants =========
    STATUS: {
        CREATED: 100100000,
        RELEASED: 100100001,
        IN_PROGRESS: 100100002,
        COMPLETED: 100100003,
        CLOSED: 100100004,
        CANCELLED: 100100005
    },

    PRIORITY: {
        URGENT: 192350000,
        IMPORTANT: 192350001,
        MEDIUM: 192350002,
        LOW: 192350003
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
        var formContext = PDG.WorkOrder.resolveFormContext(executionContext);
        console.log("PDG WorkOrder: Load start");

        // Defaults for new
        if (formContext.ui.getFormType() === 1) {
            this.setDefaults(formContext);
        }

        // Setup
        this.setupFieldDependencies(formContext);
        this.lockCalculatedFields(formContext);
        this.setupFieldEvents(formContext);

        // Initial calcs
        this.calculateProgress(formContext);
        this.calculateQuantityDerived(formContext);

        console.log("PDG WorkOrder: Load done");
    },

    onSave: function (executionContext) {
        var formContext = PDG.WorkOrder.resolveFormContext(executionContext);
        console.log("PDG WorkOrder: Save start");

        if (!this.validateWorkOrder(formContext)) {
            executionContext.getEventArgs().preventDefault();
            return false;
        }

        // Update derived values before save
        this.calculateQuantityDerived(formContext);
        this.calculateProgress(formContext);

        console.log("PDG WorkOrder: Save done");
    },

    // ========= Initialization =========

    setDefaults: function (formContext) {
        try {
            // Dates and defaults
            this.setValue(formContext, "pdg_orderdate", new Date());
            this.setValue(formContext, "pdg_workorderstatus", this.STATUS.CREATED);
            this.setValue(formContext, "pdg_priority", this.PRIORITY.MEDIUM);

            // Start produced at 0
            if (this.getValue(formContext, "pdg_quantityproduced") == null) {
                this.setValue(formContext, "pdg_quantityproduced", 0);
            }

        } catch (e) { console.error("Defaults error", e); }
    },

    setupFieldDependencies: function (formContext) {
        try {
            var statusAttr = formContext.getAttribute("pdg_workorderstatus");
            if (statusAttr) statusAttr.addOnChange(this.onStatusChange.bind(this));

            var qtyOrdAttr = formContext.getAttribute("pdg_quantityordered");
            if (qtyOrdAttr) qtyOrdAttr.addOnChange(this.calculateQuantityDerived.bind(this));

            var qtyProdAttr = formContext.getAttribute("pdg_quantityproduced");
            if (qtyProdAttr) qtyProdAttr.addOnChange(this.onQuantityProducedChange.bind(this));

            var itemAttr = formContext.getAttribute("pdg_itemid");
            if (itemAttr) itemAttr.addOnChange(this.onItemChange.bind(this));

            var plannedStart = formContext.getAttribute("pdg_plannedstartdate");
            if (plannedStart) plannedStart.addOnChange(this.validateDates.bind(this));
            var plannedEnd = formContext.getAttribute("pdg_plannedenddate");
            if (plannedEnd) plannedEnd.addOnChange(this.validateDates.bind(this));
            var actualStart = formContext.getAttribute("pdg_actualstartdate");
            if (actualStart) actualStart.addOnChange(this.validateDates.bind(this));
            var actualEnd = formContext.getAttribute("pdg_actualenddate");
            if (actualEnd) actualEnd.addOnChange(this.validateDates.bind(this));
        } catch (e) { console.error("Deps setup error", e); }
    },

    setupFieldEvents: function (formContext) {
        try {
            var statusAttr = formContext.getAttribute("pdg_workorderstatus");
            if (statusAttr) this.onStatusChange(formContext);
        } catch (e) { console.error("Field events error", e); }
    },

    lockCalculatedFields: function (formContext) {
        // No specific calculated-only fields stored; quantities are editable by design except when closed
    },

    // ========= Field Handlers =========

    onStatusChange: function (executionContext) {
        var formContext = PDG.WorkOrder.resolveFormContext(executionContext);
        var status = this.getValue(formContext, "pdg_workorderstatus");

        var isPlanningLocked = (status === this.STATUS.RELEASED || status === this.STATUS.IN_PROGRESS || status === this.STATUS.COMPLETED || status === this.STATUS.CLOSED || status === this.STATUS.CANCELLED);
        var isExecutionLocked = (status === this.STATUS.COMPLETED || status === this.STATUS.CLOSED || status === this.STATUS.CANCELLED);

        // Lock planning fields when released and beyond
        this.setDisabled(formContext, "pdg_itemid", isPlanningLocked);
        this.setDisabled(formContext, "pdg_productionwarehouseid", isPlanningLocked);
        this.setDisabled(formContext, "pdg_quantityordered", isPlanningLocked);
        this.setDisabled(formContext, "pdg_plannedstartdate", isPlanningLocked);
        this.setDisabled(formContext, "pdg_plannedenddate", isPlanningLocked);
        this.setDisabled(formContext, "pdg_plannedcost", isPlanningLocked);

        // Lock execution fields when completed/closed/cancelled
        this.setDisabled(formContext, "pdg_quantityproduced", isExecutionLocked);
        this.setDisabled(formContext, "pdg_actualstartdate", isExecutionLocked);
        this.setDisabled(formContext, "pdg_actualenddate", isExecutionLocked);
        this.setDisabled(formContext, "pdg_actualcost", isExecutionLocked);

        // When moved to Completed automatically cap produced to ordered if excessive
        if (status === this.STATUS.COMPLETED) {
            var qOrd = parseFloat(this.getValue(formContext, "pdg_quantityordered")) || 0;
            var qProd = parseFloat(this.getValue(formContext, "pdg_quantityproduced")) || 0;
            if (qProd > qOrd && qOrd > 0) {
                this.setValue(formContext, "pdg_quantityproduced", qOrd);
            }
        }
    },

    onQuantityProducedChange: function (executionContext) {
        var formContext = PDG.WorkOrder.resolveFormContext(executionContext);
        this.calculateQuantityDerived(formContext);
        this.calculateProgress(formContext);
    },

    onItemChange: function (executionContext) {
        var formContext = PDG.WorkOrder.resolveFormContext(executionContext);
        // Placeholder: could load BOM/routing meta if needed later
        // For now just clear any item-related notifications
        this.clearNotification(formContext, "pdg_itemid");
    },

    // ========= Calculations =========

    calculateQuantityDerived: function (executionContext) {
        var formContext = (executionContext && typeof executionContext.getFormContext === "function")
            ? executionContext.getFormContext()
            : executionContext;

        try {
            var qOrd = parseFloat(this.getValue(formContext, "pdg_quantityordered")) || 0;
            var qProd = parseFloat(this.getValue(formContext, "pdg_quantityproduced")) || 0;

            if (qOrd < 0) qOrd = 0; if (qProd < 0) qProd = 0;
            if (qProd > qOrd && qOrd > 0) {
                // Warn but allow; status handler caps on complete
                formContext.ui.setFormNotification("Produced exceeds Ordered; please verify.", "WARNING", "qty_overprod");
            } else {
                formContext.ui.clearFormNotification("qty_overprod");
            }

            // Show remaining as notification for quick feedback
            var remaining = Math.max(0, qOrd - qProd);
            formContext.ui.setFormNotification("Remaining Qty: " + remaining, "INFO", "qty_remaining");
        } catch (e) { console.error("Qty derived calc error", e); }
    },

    calculateProgress: function (formContext) {
        try {
            var qOrd = parseFloat(this.getValue(formContext, "pdg_quantityordered")) || 0;
            var qProd = parseFloat(this.getValue(formContext, "pdg_quantityproduced")) || 0;
            var progress = 0;
            if (qOrd > 0) progress = Math.min(100, Math.max(0, (qProd / qOrd) * 100));

            // Color hint via message
            var color = progress >= 100 ? "✅" : progress >= 50 ? "🟡" : "🟠";
            formContext.ui.setFormNotification(color + " Progress: " + progress.toFixed(1) + "%", "INFO", "wo_progress");
        } catch (e) { console.error("Progress calc error", e); }
    },

    validateDates: function (executionContext) {
        var formContext = PDG.WorkOrder.resolveFormContext(executionContext);
        try {
            var ps = this.getValue(formContext, "pdg_plannedstartdate");
            var pe = this.getValue(formContext, "pdg_plannedenddate");
            var as = this.getValue(formContext, "pdg_actualstartdate");
            var ae = this.getValue(formContext, "pdg_actualenddate");

            // Clear
            ["pdg_plannedstartdate","pdg_plannedenddate","pdg_actualstartdate","pdg_actualenddate"].forEach(function (f) {
                try { var c = formContext.getControl(f); c && c.clearNotification(); } catch (e) {}
            });

            if (ps && pe && new Date(ps) > new Date(pe)) {
                formContext.getControl("pdg_plannedenddate").setNotification("Planned End must be after Planned Start");
            }
            if (as && ae && new Date(as) > new Date(ae)) {
                formContext.getControl("pdg_actualenddate").setNotification("Actual End must be after Actual Start");
            }
        } catch (e) { console.error("Date validation error", e); }
    },

    // ========= Validation =========

    validateWorkOrder: function (formContext) {
        // Clear prior notifications on key fields
        [
            "pdg_itemid","pdg_orderdate","pdg_priority","pdg_productionwarehouseid","pdg_quantityordered",
            "pdg_plannedstartdate","pdg_plannedenddate","pdg_actualstartdate","pdg_actualenddate","pdg_workorderstatus"
        ].forEach(function (f) { try { formContext.getControl(f) && formContext.getControl(f).clearNotification(); } catch (e) {} });

        var errors = [];

        if (!this.getValue(formContext, "pdg_itemid")) {
            errors.push({ field: "pdg_itemid", msg: "Item is required" });
        }
        if (!this.getValue(formContext, "pdg_orderdate")) {
            errors.push({ field: "pdg_orderdate", msg: "Order Date is required" });
        }
        if (this.getValue(formContext, "pdg_priority") == null) {
            errors.push({ field: "pdg_priority", msg: "Priority is required" });
        }
        if (!this.getValue(formContext, "pdg_productionwarehouseid")) {
            errors.push({ field: "pdg_productionwarehouseid", msg: "Production Warehouse is required" });
        }
        var qOrd = this.getValue(formContext, "pdg_quantityordered");
        if (qOrd == null || qOrd <= 0) {
            errors.push({ field: "pdg_quantityordered", msg: "Quantity Ordered must be greater than 0" });
        }

        // Date relationships
        var ps = this.getValue(formContext, "pdg_plannedstartdate");
        var pe = this.getValue(formContext, "pdg_plannedenddate");
        var as = this.getValue(formContext, "pdg_actualstartdate");
        var ae = this.getValue(formContext, "pdg_actualenddate");
        if (ps && pe && new Date(ps) > new Date(pe)) {
            errors.push({ field: "pdg_plannedenddate", msg: "Planned End must be after Planned Start" });
        }
        if (as && ae && new Date(as) > new Date(ae)) {
            errors.push({ field: "pdg_actualenddate", msg: "Actual End must be after Actual Start" });
        }

        // Quantity relationship
        var qProd = this.getValue(formContext, "pdg_quantityproduced");
        if (qProd != null && qOrd != null && qProd < 0) {
            errors.push({ field: "pdg_quantityproduced", msg: "Quantity Produced cannot be negative" });
        }

        // Report
        if (errors.length > 0) {
            errors.forEach(function (e) { try { formContext.getControl(e.field).setNotification(e.msg); } catch (x) {} });
            formContext.ui.setFormNotification("Work Order validation failed", "ERROR", "wo_validation");
            return false;
        } else {
            formContext.ui.clearFormNotification("wo_validation");
            return true;
        }
    },

    // ========= Helpers =========

    getValue: function (formContext, fieldName) {
        var attr = formContext.getAttribute(fieldName);
        return attr ? attr.getValue() : null;
    },

    setValue: function (formContext, fieldName, value) {
        var attr = formContext.getAttribute(fieldName);
        if (attr) {
            attr.setValue(value);
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

// Optional simple proxies for form bindings
function PDG_WorkOrder_OnLoad(executionContext) { PDG.WorkOrder.onLoad(executionContext); }
function PDG_WorkOrder_OnSave(executionContext) { PDG.WorkOrder.onSave(executionContext); }

