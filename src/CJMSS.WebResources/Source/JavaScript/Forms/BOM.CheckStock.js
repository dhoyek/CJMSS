/* PDG - Bill of Materials: Client-side stock check and helpers */
var PDG = PDG || {};
PDG.BOM = (function () {
    const API_VERSION = "v9.2";
    const orgUrl = (typeof Xrm !== 'undefined' && Xrm.Utility)
        ? Xrm.Utility.getGlobalContext().getClientUrl()
        : "";

    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
    };

    const enc = encodeURIComponent;

    // Fetch active+effective BOM lines for a parent item
    async function getBomLinesForParent(parentItemId, asOfDate) {
        if (!parentItemId) return [];
        // Normalize to GUID without braces
        const id = parentItemId.replace(/[{}]/g, "");
        const dateIso = asOfDate ? new Date(asOfDate).toISOString() : new Date().toISOString();
        // Build filter: parent eq id, statecode eq Active, (effective <= date) and (end is null or end >= date)
        const filter = `(_pdg_parentitemid_value eq ${id}) and (statecode eq 0) and ` +
            `((pdg_effectivedate le ${dateIso} or pdg_effectivedate eq null) and (pdg_enddate ge ${dateIso} or pdg_enddate eq null))`;

        const select = [
            'pdg_billofmaterialsid', 'pdg_bomserial', 'pdg_bomtype',
            'pdg_quantity', 'pdg_scrapfactor', 'pdg_sequencenumber',
            'pdg_effectivedate', 'pdg_enddate',
            '_pdg_parentitemid_value',
            '_pdg_componentitemid_value',
            '_pdg_unitofmeasureid_value'
        ].join(',');

        const query = `?$select=${select}&$filter=${encodeURI(filter)}&$orderby=pdg_sequencenumber asc`;
        const res = await Xrm.WebApi.retrieveMultipleRecords('pdg_billofmaterials', query);
        return res && res.entities ? res.entities : [];
    }

    // Sum available stock for a list of item IDs, optionally scoped to a warehouse
    async function getAvailabilityByItem(itemGuids, warehouseId, useOnlineQty = true) {
        if (!itemGuids || itemGuids.length === 0) return {};
        const qtyField = useOnlineQty ? 'pdg_onlinequantity' : 'pdg_onhandquantity';
        const idsNoBraces = itemGuids.map(id => id.replace(/[{}]/g, ""));
        // Build OR filter for item IDs
        const orItems = idsNoBraces.map(g => `(_pdg_itemid_value eq ${g})`).join(' or ');
        const wh = warehouseId ? warehouseId.replace(/[{}]/g, "") : null;
        const filter = `(${orItems}) and (statecode eq 0)` + (wh ? ` and (_pdg_warehouseid_value eq ${wh})` : '');
        const query = `?$select=${qtyField},_pdg_itemid_value&$filter=${encodeURI(filter)}`;
        const res = await Xrm.WebApi.retrieveMultipleRecords('pdg_inventory', query);
        const byItem = {};
        (res.entities || []).forEach(r => {
            const itemId = r._pdg_itemid_value;
            const qty = Number(r[qtyField] || 0);
            byItem[itemId] = (byItem[itemId] || 0) + qty;
        });
        return byItem;
    }

    // Compute required quantities per component for a given parent quantity
    function computeRequirements(bomLines, parentQty) {
        const req = {};
        const qtyParent = Number(parentQty || 1);
        (bomLines || []).forEach(line => {
            const compId = line._pdg_componentitemid_value;
            const qty = Number(line.pdg_quantity || 0);
            const scrapPct = Number(line.pdg_scrapfactor || 0); // assumes percent (e.g., 5 = 5%)
            const scrapFactor = scrapPct > 0 ? (1 + (scrapPct / 100)) : 1;
            const totalReq = qtyParent * qty * scrapFactor;
            req[compId] = (req[compId] || 0) + totalReq;
        });
        return req;
    }

    // High-level: check availability for a parent item and planned qty
    async function checkAvailability(options) {
        const {
            parentItemId, // GUID (with or without braces)
            parentQuantity = 1,
            warehouseId = null, // scope availability to a warehouse (optional)
            asOfDate = null, // consider BOM effectivity on date
            useOnlineQuantity = true // otherwise uses on-hand
        } = options || {};

        if (!orgUrl) throw new Error("Xrm context not available");
        if (!parentItemId) throw new Error("parentItemId is required");

        const lines = await getBomLinesForParent(parentItemId, asOfDate);
        const req = computeRequirements(lines, parentQuantity);
        const itemIds = Object.keys(req);
        const avail = await getAvailabilityByItem(itemIds, warehouseId, useOnlineQuantity);

        // Compose result per component
        const byComponent = itemIds.map(id => {
            const required = Number(req[id] || 0);
            const available = Number(avail[id] || 0);
            const shortage = Math.max(0, required - available);
            const line = lines.find(l => l._pdg_componentitemid_value === id) || {};
            const compName = line['_pdg_componentitemid_value@OData.Community.Display.V1.FormattedValue'] || '';
            const uomName = line['_pdg_unitofmeasureid_value@OData.Community.Display.V1.FormattedValue'] || '';
            const seq = line.pdg_sequencenumber || null;
            return {
                componentItemId: id,
                componentName: compName,
                unitOfMeasureId: line._pdg_unitofmeasureid_value || null,
                unitOfMeasureName: uomName,
                sequence: seq,
                required,
                available,
                shortage
            };
        }).sort((a,b) => (a.sequence||0) - (b.sequence||0));

        return {
            parentItemId,
            parentQuantity: Number(parentQuantity || 1),
            warehouseId,
            useOnlineQuantity,
            asOfDate: asOfDate ? new Date(asOfDate).toISOString() : null,
            components: byComponent,
            hasShortages: byComponent.some(x => x.shortage > 0)
        };
    }

    // Convenience: show a simple summary dialog from a form context
    async function showAvailabilityDialog(formContext, opts) {
        function getVal(name){ try { var a=formContext&&formContext.getAttribute&&formContext.getAttribute(name); return a&&a.getValue?a.getValue():null; } catch(e){ return null; } }
        function idFromLookup(v){ return (v&&v[0]&&v[0].id)?v[0].id:null; }

        let parentId = opts && opts.parentItemId;
        if (!parentId) {
            parentId = idFromLookup(getVal('pdg_parentitemid'))
                    || idFromLookup(getVal('pdg_inventoryitemid'))
                    || idFromLookup(getVal('pdg_itemid'))
                    || idFromLookup(getVal('pdg_finisheditemid'));
        }

        // Fallback: retrieve from current BOM row if available
        if (!parentId && formContext && formContext.data && formContext.data.entity && formContext.data.entity.getId) {
            const recordId = (formContext.data.entity.getId() || '').replace(/[{}]/g, '');
            if (recordId) {
                try {
                    const rec = await Xrm.WebApi.retrieveRecord('pdg_billofmaterials', recordId, '?$select=_pdg_parentitemid_value');
                    if (rec && rec._pdg_parentitemid_value) parentId = rec._pdg_parentitemid_value;
                } catch (e) { /* ignore */ }
            }
        }

        if (!parentId) {
            return Xrm.Navigation.openAlertDialog({ text: 'Cannot determine Item. Open a BOM or Item form, or pass parentItemId.' });
        }
        const result = await checkAvailability({
            parentItemId: parentId,
            parentQuantity: (opts && opts.parentQuantity) || 1,
            warehouseId: opts && opts.warehouseId,
            asOfDate: opts && opts.asOfDate,
            useOnlineQuantity: (opts && opts.useOnlineQuantity) !== false
        });
        const lines = result.components
            .map(c => `- ${c.componentName || c.componentItemId}: required ${c.required.toFixed(3)} / available ${c.available.toFixed(3)}${c.shortage > 0 ? ` + shortage ${c.shortage.toFixed(3)}` : ''}`)
            .join("\n");
        const header = result.hasShortages ? 'BOM Availability: Shortages Detected' : 'BOM Availability: All Components Available';
        return Xrm.Navigation.openAlertDialog({ title: header, text: lines || 'No BOM components found.' });
    }

    return {
        getBomLinesForParent,
        computeRequirements,
        getAvailabilityByItem,
        checkAvailability,
        showAvailabilityDialog,
        openAvailabilityFromRibbon: async function () {
            try {
                var args = Array.prototype.slice.call(arguments || []);
                var formContext = null;

                // Try to find a formContext among args (PrimaryControl or executionContext)
                for (var i = 0; i < args.length; i++) {
                    var a = args[i];
                    if (a && typeof a.getFormContext === 'function') { formContext = a.getFormContext(); break; }
                    if (a && typeof a.getAttribute === 'function') { formContext = a; break; }
                }
                
                if (formContext) {
                    return showAvailabilityDialog(formContext, {});
                }

                // Grid usage: accept SelectedControlSelectedItemIds or FirstSelectedItemId
                var ids = [];
                function pushIdsFrom(val){
                    if (!val) return;
                    if (Array.isArray(val)) { ids = ids.concat(val); return; }
                    if (typeof val === 'string') {
                        var s = val.trim();
                        if (!s) return;
                        // JSON array string
                        if (s.startsWith('[')) { try { var arr = JSON.parse(s); if (Array.isArray(arr)) ids = ids.concat(arr); } catch(e){} return; }
                        // CSV or single GUID
                        s.split(',').forEach(function(p){ var q = (p||'').trim(); if (q) ids.push(q); });
                        return;
                    }
                }
                // Consider all non-form args as potential id containers
                for (var j = 0; j < args.length; j++) {
                    var v = args[j];
                    // Skip objects that look like form contexts
                    if (v && (typeof v.getFormContext === 'function' || typeof v.getAttribute === 'function')) continue;
                    pushIdsFrom(v);
                }

                if (ids.length === 1) {
                    var bomId = ids[0].replace(/[{}]/g, '');
                    var bom = await Xrm.WebApi.retrieveRecord('pdg_billofmaterials', bomId, '?$select=_pdg_parentitemid_value');
                    var parentItemId = bom && bom._pdg_parentitemid_value ? bom._pdg_parentitemid_value : null;
                    if (!parentItemId) {
                        return Xrm.Navigation.openAlertDialog({ text: 'Selected BOM has no parent item.' });
                    }
                    var result = await PDG.BOM.checkAvailability({ parentItemId: parentItemId });
                    var lines = result.components
                        .map(function(c){ return '- ' + (c.componentName || c.componentItemId) + ': required ' + c.required.toFixed(3) + ' / available ' + c.available.toFixed(3) + (c.shortage > 0 ? (' + shortage ' + c.shortage.toFixed(3)) : ''); })
                        .join('\n');
                    var header = result.hasShortages ? 'BOM Availability: Shortages Detected' : 'BOM Availability: All Components Available';
                    return Xrm.Navigation.openAlertDialog({ title: header, text: lines || 'No BOM components found.' });
                }

                return Xrm.Navigation.openAlertDialog({ text: 'Open on a form, or select a single BOM row in the grid.' });
            } catch (e) {
                if (typeof Xrm !== 'undefined' && Xrm.Navigation) {
                    Xrm.Navigation.openAlertDialog({ text: 'Error opening BOM Availability: ' + (e && e.message ? e.message : e) });
                } else {
                    // eslint-disable-next-line no-console
                    console.error(e);
                }
            }
        }
    };
})();

