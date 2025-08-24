
    fetch("/api/data/v9.2/EntityDefinitions(LogicalName='pdg_productionsheet')/Attributes", {
        headers: {
          "Accept": "application/json"
        }
      })
        .then(response => response.json())
        .then(data => {
          const filteredAttributes = data.value
            .filter(attr => {
              const label = attr.DisplayName?.UserLocalizedLabel?.Label;
              const isRequired = attr.RequiredLevel?.Value === "SystemRequired" || attr.RequiredLevel?.Value === "ApplicationRequired";
              return (attr.LogicalName.startsWith("pdg_") || isRequired) && label && label !== "N/A";
            })
            .map(attr => ({
              Name: attr.LogicalName,
              Label: attr.DisplayName.UserLocalizedLabel.Label,
              Type: attr.AttributeType,
              Description: attr.Description?.UserLocalizedLabel?.Label || "N/A",
              "Is Required": (attr.RequiredLevel?.Value === "SystemRequired" || attr.RequiredLevel?.Value === "ApplicationRequired") ? "Yes" : "No"
            }));
      
          console.table(filteredAttributes);
        })
        .catch(error => console.error("Error retrieving attributes:", error));
      
  