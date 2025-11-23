/* Enhanced Inventory Form JavaScript - with Wedge Scanner support */
var PDG = PDG || {};

(function () {
    // ---------- Utilities ----------
    function attr(fc, name) { try { return fc.getAttribute(name) || null; } catch (e) { return null; } }
    function ctrl(fc, name) { try { return fc.getControl(name) || null; } catch (e) { return null; } }
    function setIf(fc, name, val) { var a = attr(fc, name); if (a) { try { a.setValue(val); } catch (e) { } } }
    function getLookupId(v) { return v && v[0] && v[0].id ? v[0].id.replace(/[{}]/g, "") : null; }
    function getLookupName(v) { return v && v[0] && v[0].name ? v[0].name : ""; }
    function notify(fc, msg, level, id, timeout) {
        try {
            fc.ui.setFormNotification(msg, level || "INFO", id || ("n_" + Date.now()));
            if (timeout) setTimeout(function(){ try{ fc.ui.clearFormNotification(id); }catch(e){} }, timeout);
        } catch (e) {}
    }
    function clear(fc, id) { try { fc.ui.clearFormNotification(id); } catch (e) {} }
    function num(v){ v=(v===null||v===undefined)?0:v; var n=Number(v); return isNaN(n)?0:n; }

    PDG.Inventory = PDG.Inventory || {};

    // =========================
    // WEDGE SCANNER INTEGRATION
    // =========================
    // Pattern:
    //   BIN:XYZ     -> set Bin lookup
    //   LOT:ABC123  -> set Lot lookup
    //   SKU:..., BAR:..., QR:... or no prefix -> resolve Item
    // Notes:
    //   Most wedge scanners "type" the value then send Enter/Tab which causes a blur and triggers onChange.
    //   We also auto‑focus the scan field on load so scanning is seamless.
    //
    PDG.Inventory.enableWedgeScanner = function (formContext) {
        var scanAttr = attr(formContext, "pdg_barcodescan");
        var scanCtrl = ctrl(formContext, "pdg_barcodescan");
        if (!scanAttr || !scanCtrl) return;

        // keep the cursor in the scan field (nice for back‑to‑back scans)
        try { scanCtrl.setFocus(); } catch (e) {}

        // Existing onChange handlers will still fire; we centralize here:
        scanAttr.removeOnChange(PDG.Inventory._onScanChanged); // avoid duplicates on refresh
        scanAttr.addOnChange(PDG.Inventory._onScanChanged);
        notify(formContext, "Scanner ready: focus set to Barcode/SKU Scan. Scan a BIN:, LOT:, or Item code.", "INFO", "scan_ready", 4000);
    };

    PDG.Inventory._onScanChanged = function (executionContextOrFormCtx) {
        var formContext = executionContextOrFormCtx.getFormContext ? executionContextOrFormCtx.getFormContext() : executionContextOrFormCtx;
        var scanAttr = attr(formContext, "pdg_barcodescan");
        var code = scanAttr && scanAttr.getValue();
        if (!code) return;

        // Normalize
        code = String(code).trim();
        var raw = code;
        var upper = code.toUpperCase();

        // Decide what to resolve
        if (upper.startsWith("BIN:")) {
            PDG.Inventory._resolveBin(formContext, code.substring(4).trim());
        } else if (upper.startsWith("LOT:")) {
            PDG.Inventory._resolveLot(formContext, code.substring(4).trim());
        } else if (upper.startsWith("SKU:")) {
            PDG.Inventory._resolveItem(formContext, code.substring(4).trim());
        } else if (upper.startsWith("BAR:") || upper.startsWith("QR:")) {
            PDG.Inventory._resolveItem(formContext, code.substring(4).trim());
        } else {
            // Default: try Item by any of the known item codes
            PDG.Inventory._resolveItem(formContext, raw);
        }

        // Clear & refocus for next scan
        try { scanAttr.setValue(null); } catch (e) {}
        var scanCtrl = ctrl(formContext, "pdg_barcodescan"); 
        try { scanCtrl && scanCtrl.setFocus(); } catch (e) {}
    };

    // ---- Resolvers ----
    PDG.Inventory._resolveItem = function (formContext, value) {
        if (!value) return;
        // Try barcode / SKU / QR / Alternative SKU
        var filter = "?$select=pdg_inventoryitemid,pdg_name" +
            "&$filter=(pdg_barcode eq '" + value.replace(/'/g,"''") + "'" +
            " or pdg_sku eq '" + value.replace(/'/g,"''") + "'" +
            " or pdg_qrcode eq '" + value.replace(/'/g,"''") + "'" +
            " or pdg_alternativesku eq '" + value.replace(/'/g,"''") + "')";

        Xrm.WebApi.retrieveMultipleRecords("pdg_inventoryitem", filter).then(function(res){
            if (res.entities.length > 0) {
                var item = res.entities[0];
                var lookup = [{ id: item.pdg_inventoryitemid, name: item.pdg_name, entityType: "pdg_inventoryitem" }];
                setIf(formContext, "pdg_itemid", lookup);
                clear(formContext, "barcode_not_found");
                notify(formContext, "Item selected from scan: " + (item.pdg_name || value), "INFO", "scan_item", 2500);
            } else {
                notify(formContext, "No item found for scanned code '" + value + "'", "WARNING", "barcode_not_found", 5000);
            }
        }).catch(function(e){
            console.warn("resolveItem:", e);
        });
    };

    PDG.Inventory._resolveBin = function (formContext, value) {
        if (!value) return;
        // Try by Bin Number or Name
        var filter = "?$select=pdg_binid,pdg_name,pdg_binnumber" +
            "&$filter=(pdg_binnumber eq '" + value.replace(/'/g,"''") + "'" +
            " or pdg_name eq '" + value.replace(/'/g,"''") + "')";

        Xrm.WebApi.retrieveMultipleRecords("pdg_bin", filter).then(function(res){
            if (res.entities.length > 0) {
                var bin = res.entities[0];
                var name = bin.pdg_name || bin.pdg_binnumber || value;
                var lookup = [{ id: bin.pdg_binid, name: name, entityType: "pdg_bin" }];
                setIf(formContext, "pdg_binid", lookup);
                notify(formContext, "Bin selected from scan: " + name, "INFO", "scan_bin", 2500);
            } else {
                notify(formContext, "No bin found for '" + value + "'", "WARNING", "scan_bin_nf", 5000);
            }
        }).catch(function(e){
            console.warn("resolveBin:", e);
        });
    };

    PDG.Inventory._resolveLot = function (formContext, value) {
        if (!value) return;
        // Try Lot table by lot number or name. Adjust column if your logical name differs.
        var filter = "?$select=pdg_lotid,pdg_name,pdg_lotnumber" +
            "&$filter=(pdg_lotnumber eq '" + value.replace(/'/g,"''") + "'" +
            " or pdg_name eq '" + value.replace(/'/g,"''") + "')";

        Xrm.WebApi.retrieveMultipleRecords("pdg_lot", filter).then(function(res){
            if (res.entities.length > 0) {
                var lot = res.entities[0];
                var name = lot.pdg_name || lot.pdg_lotnumber || value;
                var lookup = [{ id: lot.pdg_lotid, name: name, entityType: "pdg_lot" }];
                setIf(formContext, "pdg_lotid", lookup);
                notify(formContext, "Lot selected from scan: " + name, "INFO", "scan_lot", 2500);
            } else {
                notify(formContext, "No lot found for '" + value + "'", "WARNING", "scan_lot_nf", 5000);
            }
        }).catch(function(e){
            console.warn("resolveLot:", e);
        });
    };

    // Hook into your existing lifecycle
    var _origOnLoad = PDG.Inventory.onLoad;
    PDG.Inventory.onLoad = function(executionContext){
        var formContext = executionContext.getFormContext();
        try { if (_origOnLoad) _origOnLoad.call(PDG.Inventory, executionContext); } catch(e){}
        PDG.Inventory.enableWedgeScanner(formContext);
    };

})();