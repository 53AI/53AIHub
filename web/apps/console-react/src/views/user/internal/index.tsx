import { useMemo } from "react";
import { PageLayoutTabs } from "@/components/PageLayout";
import { useInternalUserStats } from "@/hooks/useInternalUserStats";
import { t } from "@/locales";
import { UserAccount } from "./Account";
import { UserGroup } from "./Group";
import { UserOrganization } from "./Organization";

export function UserInternalPage() {
	const { internalUserCount, maxLimit, refreshCount } = useInternalUserStats();

	const tabs = useMemo(
		() => [
			{
				key: "account",
				label: t("internal_user.account.title"),
				children: <UserAccount onDataChange={refreshCount} />,
			},
			{
				key: "group",
				label: t("internal_user.group.title"),
				children: <UserGroup />,
			},
			{
				key: "organization",
				label: t("internal_user.organization.title"),
				children: <UserOrganization />,
			},
		],
		[refreshCount],
	);

	return (
		<PageLayoutTabs
			header={{
				title: t("internal_user.title"),
				right: (
					<span className="text-sm text-secondary">
						<span className="text-[#FF8D1A]">{internalUserCount}</span> /{" "}
						{maxLimit} {t("internal_user.account.title")}
					</span>
				),
			}}
			tabs={tabs}
		/>
	);
}

export default UserInternalPage;
