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

