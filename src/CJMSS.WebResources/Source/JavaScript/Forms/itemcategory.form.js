/* === PDG Item Category Form - JavaScript === */
var PDG = (typeof window !== "undefined" ? (window.PDG || (window.PDG = {})) : (typeof PDG !== "undefined" ? PDG : {}));

PDG.ItemCategory = {
    // ========= Utilities =========
    resolveFormContext: function (ctx) {
        try {
            if (ctx && typeof ctx.getFormContext === "function") return ctx.getFormContext();
            if (ctx && ctx.ui && typeof ctx.getAttribute === "function") return ctx; // legacy
            if (typeof Xrm !== "undefined" && Xrm && Xrm.Page) return Xrm.Page;
        } catch (e) {}
        throw new Error("Form context not available. Enable 'Pass execution context'.");
    },

    // ========= Core =========
    onLoad: function (executionContext) {
        var formContext = PDG.ItemCategory.resolveFormContext(executionContext);
        try { console.log("PDG ItemCategory: Load start"); } catch (e) {}

        try {
            this.setupCascadingFamilySubfamily(formContext);
        } catch (e) {
            console.warn("PDG ItemCategory: error setting up cascading lookups", e);
        }

        try { console.log("PDG ItemCategory: Load done"); } catch (e) {}
    },

    // ========= Cascading Family -> Subfamily =========
    setupCascadingFamilySubfamily: function (formContext) {
        var familyAttr = formContext.getAttribute("pdg_familyid");
        var subfamilyAttr = formContext.getAttribute("pdg_subfamilyid");
        var subfamilyControl = formContext.getControl("pdg_subfamilyid");

        // When family changes, re-filter subfamily
        if (familyAttr) {
            try {
                familyAttr.addOnChange(this.filterSubfamily.bind(this));
            } catch (e) {
                console.warn("ItemCategory: could not wire onChange for pdg_familyid", e);
            }
        }

        // Ensure filter is applied when subfamily lookup opens
        if (subfamilyControl && typeof subfamilyControl.addPreSearch === "function") {
            try {
                subfamilyControl.addPreSearch(function () {
                    PDG.ItemCategory.filterSubfamily({ getFormContext: function () { return formContext; } });
                });
            } catch (e) {
                console.warn("ItemCategory: could not add preSearch for pdg_subfamilyid", e);
            }
        }

        // Initial filter for existing records
        try {
            if (familyAttr && familyAttr.getValue()) {
                this.filterSubfamily({ getFormContext: function () { return formContext; } });
            }
        } catch (e) {
            console.warn("ItemCategory: error applying initial family/subfamily filter", e);
        }
    },

    filterSubfamily: function (executionContext) {
        var formContext = PDG.ItemCategory.resolveFormContext(executionContext);

        var familyAttr = formContext.getAttribute("pdg_familyid");
        var subfamilyAttr = formContext.getAttribute("pdg_subfamilyid");
        var subfamilyControl = formContext.getControl("pdg_subfamilyid");

        if (!familyAttr) {
            return;
        }

        var familyValue = familyAttr.getValue();

        // If no family selected, clear subfamily and remove any custom filter
        if (!familyValue || !familyValue[0] || !familyValue[0].id) {
            try {
                subfamilyAttr && subfamilyAttr.setValue(null);
                if (subfamilyControl && typeof subfamilyControl.clearCustomFilter === "function") {
                    subfamilyControl.clearCustomFilter();
                }
            } catch (e) {
                console.warn("ItemCategory: error clearing subfamily when family is empty", e);
            }
            return;
        }

        var familyGuid = (familyValue[0].id || "").replace(/[{}]/g, "");
        if (!familyGuid) {
            return;
        }

        // If family changed via user, clear current subfamily
        try {
            if (executionContext && typeof executionContext.getEventSource === "function") {
                var src = executionContext.getEventSource();
                if (src && src.getName && src.getName() === "pdg_familyid") {
                    subfamilyAttr && subfamilyAttr.setValue(null);
                }
            }
        } catch (e) {
            console.warn("ItemCategory: error clearing subfamily on family change", e);
        }

        // Apply custom filter on Sub Family lookup (same pattern as PDG.Item)
        if (subfamilyControl) {
            try {
                subfamilyControl.addCustomFilter(
                    "<filter type='and'><condition attribute='pdg_family' operator='eq' value='" +
                    familyGuid + "' /></filter>"
                );
            } catch (e) {
                console.error("ItemCategory: error adding custom filter to pdg_subfamilyid", e);
            }
        }

        // Optional: auto-select if only one matching subfamily exists
        try {
            if (Xrm && Xrm.WebApi && Xrm.WebApi.retrieveMultipleRecords) {
                Xrm.WebApi.retrieveMultipleRecords(
                    "pdg_itemsubfamily",
                    "?$select=pdg_itemsubfamilyid,pdg_name&$filter=_pdg_family_value eq '" + familyGuid + "'"
                ).then(function (result) {
                    if (result && result.entities && result.entities.length === 1) {
                        var sub = result.entities[0];
                        if (subfamilyAttr) {
                            subfamilyAttr.setValue([{
                                id: (sub.pdg_itemsubfamilyid || "").replace(/[{}]/g, ""),
                                name: sub.pdg_name || "",
                                entityType: "pdg_itemsubfamily"
                            }]);
                        }
                    }
                }).catch(function (error) {
                    console.error("ItemCategory: error retrieving subfamilies for auto-select", error && error.message ? error.message : error);
                });
            }
        } catch (e) {
            console.warn("ItemCategory: error in auto-select subfamily logic", e);
        }
    }
};

