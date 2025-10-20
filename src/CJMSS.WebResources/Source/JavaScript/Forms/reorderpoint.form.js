/* === PDG Reorder Point Form - JavaScript === */
var PDG = PDG || {};
PDG.ReorderPoint = {
    _cache: {
        itemPolicyById: {}
    },
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

        // Preload policy if item already selected
        try {
            var item = this.getValue(formContext, "pdg_itemid");
            if (item && item.length) {
                this.loadItemPolicy(formContext, item[0].id);
            }
        } catch (e) {}

        // Initial duplicate pre-check
        try { this.checkDuplicateActiveROP(formContext); } catch (e) {}
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

        // Load policy on item change; re-validate reorder quantity
        var itemAttr = formContext.getAttribute("pdg_itemid");
        if (itemAttr) itemAttr.addOnChange(function () {
            try {
                var v = itemAttr.getValue();
                var id = v && v.length ? v[0].id : null;
                if (id) {
                    self.loadItemPolicy(formContext, id).then(function () {
                        self.validateReorderQtyAgainstPolicy(formContext);
                        self.checkDuplicateActiveROP(formContext);
                    }).catch(function(){ self.validateReorderQtyAgainstPolicy(formContext); self.checkDuplicateActiveROP(formContext); });
                } else {
                    self.validateReorderQtyAgainstPolicy(formContext);
                    self.checkDuplicateActiveROP(formContext);
                }
            } catch (e) { self.validateReorderQtyAgainstPolicy(formContext); self.checkDuplicateActiveROP(formContext); }
        });

        var rqAttr = formContext.getAttribute("pdg_reorderquantity");
        if (rqAttr) rqAttr.addOnChange(function () { self.validateReorderQtyAgainstPolicy(formContext); });

        // Warehouse change should also trigger duplicate pre-check
        var whAttr = formContext.getAttribute("pdg_warehouseid");
        if (whAttr) whAttr.addOnChange(function () { try { self.checkDuplicateActiveROP(formContext); } catch (e) {} });
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

        // Enforce MOQ and Order Multiple if available in cache
        var policy = this.getCachedItemPolicy(formContext);
        if (policy) {
            var moq = parseFloat(policy.minimumOrderQuantity) || 0;
            var mult = parseFloat(policy.orderMultiple) || 0;
            if (rq !== null && rq !== undefined) {
                if (moq > 0 && rq < moq) {
                    errors.push({ field: "pdg_reorderquantity", msg: "Reorder Quantity must be ≥ Item MOQ (" + moq + ")" });
                }
                if (mult > 0) {
                    var rem = mult > 0 ? (rq % mult) : 0;
                    // treat tiny remainders as zero to avoid float noise
                    if (Math.abs(rem) > 1e-9 && Math.abs(rem - mult) > 1e-9) {
                        errors.push({ field: "pdg_reorderquantity", msg: "Reorder Quantity must be a multiple of " + mult });
                    }
                }
            }
        }

        if (errors.length) {
            errors.forEach(function (e) { try { var c = formContext.getControl(e.field); c && c.setNotification(e.msg); } catch (x) {} });
            try { formContext.ui.setFormNotification("Reorder Point validation failed", "ERROR", "rop_validation"); } catch (e) {}
            return false;
        }
        try { formContext.ui.clearFormNotification("rop_validation"); } catch (e) {}
        return true;
    },

    // ========= Item Policy Helpers =========
    loadItemPolicy: function (formContext, itemId) {
        var self = this;
        try { if (!itemId) return Promise.resolve(null); } catch (e) { return Promise.resolve(null); }
        var cleanId = (itemId || "").replace(/[{}]/g, "");
        if (self._cache.itemPolicyById[cleanId]) return Promise.resolve(self._cache.itemPolicyById[cleanId]);
        if (typeof Xrm === "undefined" || !Xrm.WebApi || typeof Xrm.WebApi.retrieveRecord !== "function") return Promise.resolve(null);
        return Xrm.WebApi.retrieveRecord("pdg_inventoryitem", cleanId, "?$select=pdg_minimumorderquantity,pdg_ordermultiple,pdg_maximumorderqty")
            .then(function (rec) {
                var policy = {
                    minimumOrderQuantity: rec.pdg_minimumorderquantity,
                    orderMultiple: rec.pdg_ordermultiple,
                    maximumOrderQty: rec.pdg_maximumorderqty
                };
                self._cache.itemPolicyById[cleanId] = policy;
                return policy;
            })
            .catch(function () { return null; });
    },
    getCachedItemPolicy: function (formContext) {
        try {
            var v = this.getValue(formContext, "pdg_itemid");
            var id = v && v.length ? v[0].id : null;
            if (!id) return null;
            return this._cache.itemPolicyById[(id || "").replace(/[{}]/g, "")] || null;
        } catch (e) { return null; }
    },
    validateReorderQtyAgainstPolicy: function (formContext) {
        try {
            var c = formContext.getControl("pdg_reorderquantity");
            if (c && typeof c.clearNotification === "function") c.clearNotification();
            var rq = parseFloat(this.getValue(formContext, "pdg_reorderquantity")) || 0;
            var policy = this.getCachedItemPolicy(formContext);
            if (!policy) return; // nothing to enforce yet
            var msgs = [];
            var moq = parseFloat(policy.minimumOrderQuantity) || 0;
            var mult = parseFloat(policy.orderMultiple) || 0;
            if (moq > 0 && rq > 0 && rq < moq) msgs.push("Must be ≥ MOQ (" + moq + ")");
            if (mult > 0 && rq > 0) {
                var rem = rq % mult;
                if (Math.abs(rem) > 1e-9 && Math.abs(rem - mult) > 1e-9) msgs.push("Must be a multiple of " + mult);
            }
            if (msgs.length && c && typeof c.setNotification === "function") {
                c.setNotification(msgs.join("; "));
            }
        } catch (e) {}
    },

    // ========= Duplicate Pre-Check (Client-side Warning) =========
    checkDuplicateActiveROP: function (formContext) {
        try {
            var warnId = "rop_duplicate_warn";
            try { formContext.ui.clearFormNotification(warnId); } catch (e) {}
            var item = this.getValue(formContext, "pdg_itemid");
            var wh = this.getValue(formContext, "pdg_warehouseid");
            var itemId = item && item.length ? (item[0].id || "").replace(/[{}]/g, "") : null;
            var whId = wh && wh.length ? (wh[0].id || "").replace(/[{}]/g, "") : null;
            if (!itemId || !whId) return;

            if (typeof Xrm === "undefined" || !Xrm.WebApi || typeof Xrm.WebApi.retrieveMultipleRecords !== "function") return;

            var self = this;
            var currentId = "";
            try { currentId = (formContext.data && formContext.data.entity && formContext.data.entity.getId && formContext.data.entity.getId()) || ""; } catch (e) {}
            currentId = (currentId || "").replace(/[{}]/g, "");

            var filter = "$select=pdg_reorderpointid&$top=1" +
                "&$filter=(statecode eq 0) and (pdg_isactive eq true) and " +
                "(pdg_itemid eq " + itemId + ") and (pdg_warehouseid eq " + whId + ")" +
                (currentId ? " and (pdg_reorderpointid ne " + currentId + ")" : "");

            Xrm.WebApi.retrieveMultipleRecords("pdg_reorderpoint", filter).then(function (res) {
                try {
                    if (res && res.entities && res.entities.length > 0) {
                        var msg = "Another active Reorder Point exists for this Item and Warehouse. Saving will be blocked by server.";
                        try { formContext.ui.setFormNotification(msg, "WARNING", warnId); } catch (e) {}
                        var ic = formContext.getControl("pdg_itemid"); if (ic && ic.setNotification) ic.setNotification("Duplicate active ROP");
                        var wc = formContext.getControl("pdg_warehouseid"); if (wc && wc.setNotification) wc.setNotification("Duplicate active ROP");
                    } else {
                        var ic2 = formContext.getControl("pdg_itemid"); if (ic2 && ic2.clearNotification) ic2.clearNotification();
                        var wc2 = formContext.getControl("pdg_warehouseid"); if (wc2 && wc2.clearNotification) wc2.clearNotification();
                    }
                } catch (e) {}
            }).catch(function () { /* ignore */ });
        } catch (e) { /* no-op */ }
    }
};
