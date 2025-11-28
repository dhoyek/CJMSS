/* === PDG Salesperson Form === */
var PDG = PDG || {};
PDG.Salesperson = {
    // Option set values (global PersonType): System User = 100100000, External = 100100001
    TYPE_SYSTEM_USER: 100100000,
    TYPE_EXTERNAL: 100100001,

    onLoad: function (executionContext) {
        var formContext = executionContext.getFormContext();
        this.applyTypeVisibility(formContext);
        this.wireEvents(formContext);
        this.setupCategoryFilter(formContext);
        this.setupZoneFilter(formContext);
    },

    wireEvents: function (formContext) {
        var typeAttr = formContext.getAttribute("pdg_salespersontype");
        if (typeAttr) {
            typeAttr.removeOnChange(PDG.Salesperson.applyTypeVisibility);
            typeAttr.addOnChange(PDG.Salesperson.applyTypeVisibility.bind(PDG.Salesperson));
        }
    },

    applyTypeVisibility: function (formContextOrExecutionContext) {
        // Handler may be bound directly (executionContext) or via bind above (formContext)
        var formContext = formContextOrExecutionContext.getFormContext
            ? formContextOrExecutionContext.getFormContext()
            : formContextOrExecutionContext;

        var typeAttr = formContext.getAttribute("pdg_salespersontype");
        var userAttr = formContext.getAttribute("pdg_userid");
        var contactAttr = formContext.getAttribute("pdg_contactid");
        var userCtrl = formContext.getControl("pdg_userid");
        var contactCtrl = formContext.getControl("pdg_contactid");

        var val = typeAttr ? typeAttr.getValue() : null;
        var isUser = val === PDG.Salesperson.TYPE_SYSTEM_USER;
        var isContact = val === PDG.Salesperson.TYPE_EXTERNAL;

        if (userCtrl) userCtrl.setVisible(isUser);
        if (contactCtrl) contactCtrl.setVisible(isContact);

        if (userAttr) {
            userAttr.setRequiredLevel(isUser ? "required" : "none");
            if (!isUser) userAttr.setValue(null);
        }
        if (contactAttr) {
            contactAttr.setRequiredLevel(isContact ? "required" : "none");
            if (!isContact) contactAttr.setValue(null);
        }
    },

    setupCategoryFilter: function (formContext) {
        var ctrl = formContext.getControl("pdg_salesmancategoryid");
        if (!ctrl || typeof ctrl.addPreSearch !== "function") return;

        var filter =
            "<filter type='and'>" +
                "<condition attribute='pdg_categorytype' operator='eq' value='100100003' />" + // Salesman
                "<condition attribute='statecode' operator='eq' value='0' />" +
            "</filter>";

        ctrl.addPreSearch(function () {
            try { ctrl.addCustomFilter(filter, "pdg_accountcategory"); } catch (e) {}
        });
    },

    setupZoneFilter: function (formContext) {
        var ctrl = formContext.getControl("pdg_zoneid");
        if (!ctrl || typeof ctrl.addPreSearch !== "function") return;

        var filter =
            "<filter type='and'>" +
                "<condition attribute='statecode' operator='eq' value='0' />" +
            "</filter>";

        ctrl.addPreSearch(function () {
            try { ctrl.addCustomFilter(filter, "pdg_zone"); } catch (e) {}
        });
    }
};
