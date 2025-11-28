/* === PDG Reason Codes Form === */
var PDG = PDG || {};
PDG.ReasonCodes = {
    onLoad: function (executionContext) {
        var formContext = executionContext.getFormContext();
        try {
            this.setupCategoryLookup(formContext);
        } catch (e) {
            console.warn("ReasonCodes: category filter not applied", e);
        }
    },

    setupCategoryLookup: function (formContext) {
        var ctrl = formContext.getControl("pdg_categoryid");
        if (!ctrl || typeof ctrl.addPreSearch !== "function") return;

        var categoryFilter =
            "<filter type='and'>" +
                "<condition attribute='pdg_categorytype' operator='eq' value='100100006' />" + // Reason
                "<condition attribute='statecode' operator='eq' value='0' />" + // Active
            "</filter>";

        ctrl.addPreSearch(function () {
            try { ctrl.addCustomFilter(categoryFilter, "pdg_accountcategory"); } catch (e) {}
        });

        // Provide a focused view for Reason categories and make it default
        try {
            var viewId = "{A3E8D8C3-9F7A-4A2F-9E4D-ReasonCat0001}";
            var fetchXml =
                "<fetch version='1.0' mapping='logical'>" +
                    "<entity name='pdg_accountcategory'>" +
                        "<attribute name='pdg_categoryname' />" +
                        "<attribute name='pdg_categorycode' />" +
                        "<attribute name='pdg_categorytype' />" +
                        "<order attribute='pdg_categoryname' descending='false' />" +
                        "<filter type='and'>" +
                            "<condition attribute='pdg_categorytype' operator='eq' value='100100006' />" +
                            "<condition attribute='statecode' operator='eq' value='0' />" +
                        "</filter>" +
                    "</entity>" +
                "</fetch>";
            var layoutXml =
                "<grid name='resultset' object='10065' jump='pdg_categoryname' select='1' icon='1' preview='1'>" +
                    "<row name='result' id='pdg_accountcategoryid'>" +
                        "<cell name='pdg_categoryname' width='200' />" +
                        "<cell name='pdg_categorycode' width='100' />" +
                    "</row>" +
                "</grid>";
            ctrl.addCustomView(viewId, "pdg_accountcategory", "Reason Categories", fetchXml, layoutXml, true);
            ctrl.setDefaultView(viewId);
        } catch (ex) {
            console.warn("ReasonCodes: custom view not applied", ex);
        }
    }
};
