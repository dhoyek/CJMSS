/* === PDG BOM Form (Structured like item.form.js) === */
var PDG = PDG || {};
PDG.BOMForm = {
    // ========= Constants =========
    IDS: {
        panel: 'WebResource_BOMAvailability',
        parentField: 'pdg_parentitemid',
        componentField: 'pdg_componentitemid',
        sequenceField: 'pdg_sequencenumber'
    },

    // ========= Core Event Handlers =========

    onLoad: function (executionContext) {
        var formContext = executionContext.getFormContext();

        try { this.autoFilterComponentLookup(formContext); } catch (e) { console.warn(e); }
        try { this.guardParentNotComponent(formContext); } catch (e) { console.warn(e); }

        // Wire parent change
        try {
            var parentAttr = formContext.getAttribute(this.IDS.parentField);
            if (parentAttr && parentAttr.addOnChange) parentAttr.addOnChange(this.onParentChange.bind(this));
        } catch (e) { console.warn(e); }

        // Inline availability warnings as users edit component/qty/scrap
        try { this.setupInlineAvailability(formContext); } catch (e) { console.warn(e); }

        // Initial suggestion for new/empty sequence
        this.suggestSequence(formContext);
        // Initial inline availability (non-blocking)
        this.checkInlineAvailability(formContext);
    },

    onSave: function (executionContext) {
        // currently validation is executed via addOnSave guard
    },

    onParentChange: function (executionContext) {
        var formContext = executionContext.getFormContext ? executionContext.getFormContext() : executionContext;
        this.suggestSequence(formContext);
        this.refreshPanel(formContext);
    },

    // ========= Helpers =========

    getAttr: function (fc, name) { try { return fc.getAttribute(name); } catch (e) { return null; } },
    getVal: function (fc, name) { var a = this.getAttr(fc, name); return a && a.getValue ? a.getValue() : null; },
    getLookupId: function (fc, name) { var v = this.getVal(fc, name); return (v && v[0] && v[0].id) ? v[0].id : null; },

    refreshPanel: function (formContext) {
        try {
            var c = formContext.getControl && formContext.getControl(this.IDS.panel);
            if (c && c.getSrc) { var s = c.getSrc(); c.setSrc(s); }
        } catch (e) { /* ignore */ }
    },

    suggestSequence: async function (formContext) {
        try {
            var seqAttr = this.getAttr(formContext, this.IDS.sequenceField);
            if (!seqAttr) return;
            var current = seqAttr.getValue();
            var parentId = this.getLookupId(formContext, this.IDS.parentField);
            if (current != null || !parentId) return; // only suggest if empty and parent present

            var id = (parentId || '').replace(/[{}]/g, '');
            var query = "?$select=pdg_sequencenumber&$filter=" + encodeURI("_pdg_parentitemid_value eq " + id) + "&$orderby=pdg_sequencenumber desc&$top=1";
            var res = await Xrm.WebApi.retrieveMultipleRecords('pdg_billofmaterials', query);
            var next = 10;
            if (res && res.entities && res.entities.length > 0) {
                var last = res.entities[0].pdg_sequencenumber;
                if (typeof last === 'number') next = last + 10; else if (last) next = Number(last) || 10;
            }
            seqAttr.setValue(next);
            if (seqAttr.fireOnChange) seqAttr.fireOnChange();
        } catch (e) { /* ignore but keep UX smooth */ }
    },

    autoFilterComponentLookup: function (formContext) {
        var compCtrl = formContext.getControl && formContext.getControl(this.IDS.componentField);
        if (compCtrl && compCtrl.addPreSearch) {
            var self = this;
            compCtrl.addPreSearch(function () {
                var parentId = self.getLookupId(formContext, self.IDS.parentField);
                if (!parentId) return;
                var id = parentId.replace(/[{}]/g, '');
                var filterXml = "<filter type='and'><condition attribute='pdg_inventoryitemid' operator='ne' value='" + id + "' /></filter>";
                try { compCtrl.addCustomFilter(filterXml, 'pdg_inventoryitem'); } catch (e) { }
            });
        }
    },

    guardParentNotComponent: function (formContext) {
        if (formContext.data && formContext.data.entity && formContext.data.entity.addOnSave) {
            var self = this;
            formContext.data.entity.addOnSave(function (ctx) {
                var p = self.getLookupId(formContext, self.IDS.parentField);
                var c = self.getLookupId(formContext, self.IDS.componentField);
                if (p && c && p.replace(/[{}]/g, '').toLowerCase() === c.replace(/[{}]/g, '').toLowerCase()) {
                    try { formContext.ui.setFormNotification('Parent Item and Component Item cannot be the same.', 'ERROR', 'bom_same_item'); } catch (_) { }
                    if (ctx.getEventArgs) ctx.getEventArgs().preventDefault();
                } else {
                    try { formContext.ui.clearFormNotification && formContext.ui.clearFormNotification('bom_same_item'); } catch (_) { }
                }
            });
        }
    },

    // ========= Inline Availability =========

    _debounce: function (fn, ms) {
        var t; return function () { var self = this, args = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(self, args); }, ms); };
    },

    setupInlineAvailability: function (formContext) {
        var self = this;
        var fields = [this.IDS.componentField, 'pdg_quantity', 'pdg_scrapfactor'];
        fields.forEach(function (f) {
            try {
                var a = formContext.getAttribute(f);
                if (a && a.addOnChange) a.addOnChange(self._debounce(function () { self.checkInlineAvailability(formContext); }, 200));
            } catch (e) { }
        });
    },

    checkInlineAvailability: async function (formContext) {
        try {
            var parentId = this.getLookupId(formContext, this.IDS.parentField);
            var compId = this.getLookupId(formContext, this.IDS.componentField);
            var qty = this.getVal(formContext, 'pdg_quantity');
            var scrap = this.getVal(formContext, 'pdg_scrapfactor');
            // Only evaluate when we have sufficient context
            if (!parentId || !compId || qty == null) { this._setAvailabilityBanner(formContext, null); return; }

            var scrapFactor = (scrap && !isNaN(scrap) && Number(scrap) > 0) ? 1 + (Number(scrap) / 100) : 1;
            var required = Number(qty || 0) * scrapFactor;

            // Availability across all warehouses (online quantity by default)
            var idsNoBraces = [compId.replace(/[{}]/g, '')];
            var filter = `(_pdg_itemid_value eq ${idsNoBraces[0]}) and (statecode eq 0)`;
            var res = await Xrm.WebApi.retrieveMultipleRecords('pdg_inventory', `?$select=pdg_onlinequantity,_pdg_itemid_value&$filter=${encodeURI(filter)}`);
            var available = 0;
            (res.entities || []).forEach(function (r) { available += Number(r.pdg_onlinequantity || 0); });
            var shortage = Math.max(0, required - available);

            var state = { required: required, available: available, shortage: shortage };
            this._setAvailabilityBanner(formContext, state);
            // Cache state for ribbon rules or other consumers
            try { formContext._pdg_bom_inlineAvailability = state; } catch (e) { }
        } catch (e) {
            // On any failure, remove banner (stay non-blocking)
            this._setAvailabilityBanner(formContext, null);
        }
    },

    _setAvailabilityBanner: function (formContext, state) {
        var id = 'bom_inline_availability';
        try { formContext.ui.clearFormNotification && formContext.ui.clearFormNotification(id); } catch (_) { }
        if (!state) return;
        if (state.shortage > 0) {
            try { formContext.ui.setFormNotification(`Shortage: required ${state.required.toFixed(3)} / available ${state.available.toFixed(3)} (online)`, 'WARNING', id); } catch (_) { }
        } else {
            // Optional: show success; keep UI clean by default
        }
    },

    // Function usable from Ribbon rules (returns boolean): has inline shortage
    hasInlineShortage: function (primaryControl) {
        try {
            var fc = primaryControl && primaryControl.getFormContext ? primaryControl.getFormContext() : primaryControl;
            var st = fc && fc._pdg_bom_inlineAvailability; return !!(st && st.shortage > 0);
        } catch (e) { return false; }
    }
};

// ===== Auto-wire (no UI event bindings needed) =====
(function autoInitBOMForm () {
    var tries = 0;
    function attempt() {
        try {
            if (!window.Xrm || !Xrm.Page || !Xrm.Page.getAttribute) throw new Error('Form not ready');
            if (window.__pdg_bomform_autowired) return;
            var fc = Xrm.Page; // UCI shim to formContext

            // Attach parent change
            try {
                var parentAttr = fc.getAttribute && fc.getAttribute(PDG.BOMForm.IDS.parentField);
                if (parentAttr && parentAttr.addOnChange) {
                    parentAttr.addOnChange(function () {
                        PDG.BOMForm.onParentChange(fc);
                    });
                }
            } catch (e) { /* ignore */ }

            // Initial suggest + refresh
            try { PDG.BOMForm.onParentChange(fc); } catch (e) { }

            // Also re-run on form load in case attributes hydrate late
            try {
                if (fc.data && fc.data.addOnLoad) {
                    fc.data.addOnLoad(function () { PDG.BOMForm.onParentChange(fc); });
                }
            } catch (e) { /* ignore */ }

            window.__pdg_bomform_autowired = true;
            return;
        } catch (e) { /* retry */ }
        if (tries++ < 12) setTimeout(attempt, 150);
    }
    attempt();
})();
