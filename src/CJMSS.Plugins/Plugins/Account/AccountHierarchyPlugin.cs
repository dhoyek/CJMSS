using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace CJMSS.Plugins.Plugins.Account
{
    /// <summary>
    /// Keeps account hierarchy flags in sync with parentaccountid.
    ///
    /// OptionSet values:
    ///   Single = 100100000
    ///   Master = 100100001
    ///   Child  = 100100002
    ///
    /// Suggested registration:
    ///   - Entity: account
    ///   - Message: Create, Update
    ///   - Stage: PostOperation, Synchronous
    ///   - Filtering attributes (Update): parentaccountid, pdg_hierarchytype
    ///   - Images: PreImage (parentaccountid, pdg_hierarchytype), PostImage (parentaccountid, pdg_hierarchytype)
    /// </summary>
    public class AccountHierarchyPlugin : IPlugin
    {
        private const string AccountEntity = "account";
        private const string ParentAttribute = "parentaccountid";
        private const string HierarchyAttribute = "pdg_hierarchytype";

        private const int HierarchySingle = 100100000;
        private const int HierarchyMaster = 100100001;
        private const int HierarchyChild = 100100002;

        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            if (!string.Equals(context.PrimaryEntityName, AccountEntity, StringComparison.OrdinalIgnoreCase))
                return;

            var serviceFactory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var service = serviceFactory.CreateOrganizationService(context.UserId);

            var target = context.InputParameters.Contains("Target") ? context.InputParameters["Target"] as Entity : null;
            var post = GetImage(context, "PostImage");
            var pre = GetImage(context, "PreImage");

            if (target == null && post == null)
                return;

            var accountId = target?.Id ?? post.Id;
            var postParent = GetParentId(post ?? target);
            var preParent = GetParentId(pre);

            // Handle reassignment/removal
            if (postParent != Guid.Empty)
            {
                // Mark this account as Child
                SetHierarchyIfNeeded(service, accountId, HierarchyChild);

                // Ensure parent is Master
                SetHierarchyIfNeeded(service, postParent, HierarchyMaster);

                // If parent changed, re-evaluate the old parent
                if (preParent != Guid.Empty && preParent != postParent)
                {
                    ReevaluateParentStatus(service, preParent);
                }
            }
            else
            {
                // No parent set -> re-evaluate this account (Single if no children, else Master)
                ReevaluateParentStatus(service, accountId);

                // If parent was removed, re-evaluate the old parent
                if (preParent != Guid.Empty)
                {
                    ReevaluateParentStatus(service, preParent);
                }
            }
        }

        private static Entity GetImage(IPluginExecutionContext context, string name)
        {
            if (context.PostEntityImages != null && context.PostEntityImages.Contains(name))
                return context.PostEntityImages[name];
            if (context.PreEntityImages != null && context.PreEntityImages.Contains(name))
                return context.PreEntityImages[name];
            return null;
        }

        private static Guid GetParentId(Entity entity)
        {
            if (entity == null || !entity.Attributes.Contains(ParentAttribute))
                return Guid.Empty;

            var refVal = entity[ParentAttribute] as EntityReference;
            return refVal?.Id ?? Guid.Empty;
        }

        private static int? GetHierarchy(Entity entity)
        {
            if (entity == null || !entity.Attributes.Contains(HierarchyAttribute))
                return null;

            var opt = entity[HierarchyAttribute] as OptionSetValue;
            return opt?.Value;
        }

        private static void SetHierarchyIfNeeded(IOrganizationService service, Guid accountId, int desiredValue)
        {
            if (accountId == Guid.Empty) return;

            var current = service.Retrieve(AccountEntity, accountId, new ColumnSet(HierarchyAttribute));
            var existing = GetHierarchy(current);

            if (existing != desiredValue)
            {
                var update = new Entity(AccountEntity, accountId);
                update[HierarchyAttribute] = new OptionSetValue(desiredValue);
                service.Update(update);
            }
        }

        private static void ReevaluateParentStatus(IOrganizationService service, Guid accountId)
        {
            if (accountId == Guid.Empty) return;

            // Count active children
            var qe = new QueryExpression(AccountEntity)
            {
                ColumnSet = new ColumnSet(false),
                Criteria = new FilterExpression
                {
                    Conditions =
                    {
                        new ConditionExpression(ParentAttribute, ConditionOperator.Equal, accountId)
                    }
                },
                TopCount = 2 // only need to know if there is at least one
            };

            var children = service.RetrieveMultiple(qe);
            var hasChildren = children.Entities.Any();

            var desired = hasChildren ? HierarchyMaster : HierarchySingle;
            SetHierarchyIfNeeded(service, accountId, desired);
        }
    }
}
