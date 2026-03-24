/* === PDG Account Form - JavaScript === */
var PDG = (typeof window !== "undefined" ? (window.PDG || (window.PDG = {})) : (typeof PDG !== "undefined" ? PDG : {}));

PDG.Account = {
    // ========= Utilities =========
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") return ctx.getFormContext();
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") return ctx; // legacy Xrm.Page
            if (typeof Xrm !== "undefined" && Xrm && Xrm.Page) return Xrm.Page;
        } catch (e) { }
        throw new Error("Form context not available. Enable 'Pass execution context'.");
    },

    // ========= Core Handlers =========
    onLoad: function (executionContext) {
        var formContext = PDG.Account.resolveFormContext(executionContext);

        try {
            PDG.Account.registerHandlers(formContext);
            PDG.Account.applyInitialUIState(formContext);
        } catch (e) {
            try {
                console.warn("PDG.Account.onLoad error", e);
            } catch (ex) { }
        }
    },

    onSave: function (executionContext) {
        var formContext = PDG.Account.resolveFormContext(executionContext);
        var eventArgs = executionContext && typeof executionContext.getEventArgs === "function"
            ? executionContext.getEventArgs()
            : null;

        var ok = true;

        try {
            if (!PDG.Account.validateCreditLimit(formContext)) {
                ok = false;
                if (eventArgs && typeof eventArgs.preventDefault === "function") {
                    eventArgs.preventDefault();
                }
            }
            PDG.Account.applyHierarchyUI(formContext); // ensure UI and values are consistent on save
        } catch (e) {
            try {
                console.warn("PDG.Account.onSave validation error", e);
            } catch (ex) { }
        }

        return ok;
    },

    // ========= Wiring =========
    registerHandlers: function (formContext) {
        var blacklistAttr = formContext.getAttribute("pdg_blacklisted");
        if (blacklistAttr && typeof blacklistAttr.addOnChange === "function") {
            try {
                blacklistAttr.addOnChange(PDG.Account.updateBlacklistUI.bind(PDG.Account));
            } catch (e) {
                console.warn("PDG.Account: could not wire onChange for pdg_blacklisted", e);
            }
        }

        var clearanceAttr = formContext.getAttribute("pdg_isclearanceagent");
        if (clearanceAttr && typeof clearanceAttr.addOnChange === "function") {
            try {
                clearanceAttr.addOnChange(PDG.Account.updateClearanceUI.bind(PDG.Account));
            } catch (e) {
                console.warn("PDG.Account: could not wire onChange for pdg_isclearanceagent", e);
            }
        }

        var hierarchyAttr = formContext.getAttribute("pdg_hierarchytype");
        if (hierarchyAttr && typeof hierarchyAttr.addOnChange === "function") {
            try {
                hierarchyAttr.addOnChange(function () { PDG.Account.applyHierarchyUI(formContext); });
            } catch (e) {
                console.warn("PDG.Account: could not wire onChange for pdg_hierarchytype", e);
            }
        }

        var parentAttr = formContext.getAttribute("parentaccountid");
        if (parentAttr && typeof parentAttr.addOnChange === "function") {
            try {
                parentAttr.addOnChange(function () { PDG.Account.handleParentChange(formContext); });
            } catch (e) {
                console.warn("PDG.Account: could not wire onChange for parentaccountid", e);
            }
        }
    },

    applyInitialUIState: function (formContext) {
        try {
            PDG.Account.updateBlacklistUI({ getFormContext: function () { return formContext; } });
        } catch (e) {
            try { console.warn("PDG.Account: error applying initial blacklist UI", e); } catch (ex) { }
        }

        try {
            PDG.Account.updateClearanceUI({ getFormContext: function () { return formContext; } });
        } catch (e) {
            try { console.warn("PDG.Account: error applying initial clearance UI", e); } catch (ex) { }
        }

        try {
            PDG.Account.applyHierarchyUI(formContext);
        } catch (e) {
            try { console.warn("PDG.Account: error applying initial hierarchy UI", e); } catch (ex) { }
        }
    },

    // ========= UI Logic =========
    updateBlacklistUI: function (executionContext) {
        var formContext = PDG.Account.resolveFormContext(executionContext);

        var blacklistAttr = formContext.getAttribute("pdg_blacklisted");
        var reasonAttr = formContext.getAttribute("pdg_blacklistreason");
        var reasonCtrl = formContext.getControl("pdg_blacklistreason");

        if (!reasonCtrl || !reasonAttr || !blacklistAttr) {
            return;
        }

        var isBlacklisted = !!blacklistAttr.getValue();

        try {
            reasonCtrl.setVisible(isBlacklisted);
            reasonAttr.setRequiredLevel(isBlacklisted ? "required" : "none");
            if (!isBlacklisted) {
                reasonAttr.setValue(null);
            }
        } catch (e) {
            try {
                console.warn("PDG.Account.updateBlacklistUI error", e);
            } catch (ex) { }
        }
    },

    updateClearanceUI: function (executionContext) {
        var formContext = PDG.Account.resolveFormContext(executionContext);

        var isAgentAttr = formContext.getAttribute("pdg_isclearanceagent");
        var codeAttr = formContext.getAttribute("pdg_clearancecode");
        var codeCtrl = formContext.getControl("pdg_clearancecode");

        if (!isAgentAttr || !codeCtrl || !codeAttr) {
            return;
        }

        var isAgent = !!isAgentAttr.getValue();

        try {
            codeCtrl.setVisible(isAgent);
            codeAttr.setRequiredLevel(isAgent ? "required" : "none");
        } catch (e) {
            try {
                console.warn("PDG.Account.updateClearanceUI error", e);
            } catch (ex) { }
        }
    },

    applyHierarchyUI: function (formContext) {
        var hierarchyAttr = formContext.getAttribute("pdg_hierarchytype");
        var parentCtrl = formContext.getControl("parentaccountid");
        var subgrid = formContext.getControl("Subgrid_child_accounts");

        if (!hierarchyAttr || !parentCtrl || !subgrid) {
            return;
        }

        var val = hierarchyAttr.getValue();
        // OptionSet values: 100100000 (Single), 100100001 (Master), 100100002 (Child)
        var isMaster = val === 100100001;
        var isChild = val === 100100002;
        var isSingle = !isMaster && !isChild; // default to single

        try {
            parentCtrl.setVisible(isChild);          // child: show parent lookup
            parentCtrl.setDisabled(isMaster);        // optional: disable on master
            subgrid.setVisible(isMaster);            // master: show related accounts
            if (isSingle) {
                // hide both for single
                parentCtrl.setVisible(false);
                subgrid.setVisible(false);
            }
        } catch (e) {
            try { console.warn("PDG.Account.applyHierarchyUI error", e); } catch (ex) { }
        }
    },

    handleParentChange: function (formContext) {
        var parentAttr = formContext.getAttribute("parentaccountid");
        var hierarchyAttr = formContext.getAttribute("pdg_hierarchytype");
        if (!parentAttr || !hierarchyAttr) return;

        var parentVal = parentAttr.getValue();
        if (parentVal && parentVal.length > 0) {
            // set this record as child
            try { hierarchyAttr.setValue(100100002); } catch (e) { }
            // ensure parent is marked as master (best-effort)
            try {
                var parentId = parentVal[0].id.replace(/[{}]/g, "");
                PDG.Account.ensureParentIsMaster(parentId);
            } catch (e) {
                try { console.warn("PDG.Account.handleParentChange ensure parent master failed", e); } catch (ex) { }
            }
        } else {
            // no parent -> default to Single
            try { hierarchyAttr.setValue(100100000); } catch (e) { }
        }

        PDG.Account.applyHierarchyUI(formContext);
    },

    ensureParentIsMaster: function (parentId) {
        if (!parentId || typeof Xrm === "undefined" || !Xrm.WebApi || !Xrm.WebApi.online) return;
        try {
            Xrm.WebApi.online.updateRecord("account", parentId, { "pdg_hierarchytype": 100100001 });
        } catch (e) {
            try { console.warn("PDG.Account.ensureParentIsMaster failed", e); } catch (ex) { }
        }
    },

    // ========= Validation =========
    validateCreditLimit: function (formContext) {
        var creditAttr = formContext.getAttribute("creditlimit");
        if (!creditAttr) {
            return true;
        }

        var value = creditAttr.getValue();
        var isValid = (value === null || value === undefined || value >= 0);

        try {
            if (!isValid) {
                if (formContext.ui && typeof formContext.ui.setFormNotification === "function") {
                    formContext.ui.setFormNotification("Credit limit cannot be negative.", "ERROR", "PDG_CreditLimit");
                }
            } else {
                if (formContext.ui && typeof formContext.ui.clearFormNotification === "function") {
                    formContext.ui.clearFormNotification("PDG_CreditLimit");
                }
            }
        } catch (e) {
            try {
                console.warn("PDG.Account.validateCreditLimit notification error", e);
            } catch (ex) { }
        }

        return isValid;
    }
};
