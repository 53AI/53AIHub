import { SearchOutlined } from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import { Input, Select } from "antd";
import { useEffect, useMemo, useState } from "react";
import { t } from "@/locales";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { useSkillsStore } from "@/stores/modules/skills";
import SkillList from "./SkillList";

interface MyListProps {}

export function MyList({}: MyListProps = {}) {
  const skillsStore = useSkillsStore();
  const isSoftStyle = useIsSoftStyle();
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<"created_time" | "updated_time">(
    "created_time",
  );

  useEffect(() => {
    skillsStore.loadMySkillList(true);
  }, []);

  const sortOptions = useMemo(
    () => [
      {
        label: t("agent.sort_by_created_time"),
        value: "created_time" as const,
      },
      {
        label: t("agent.sort_by_updated_time"),
        value: "updated_time" as const,
      },
    ],
    [],
  );

  return (
    <div>
      {/* Header with sticky position */}
      <div className="bg-white">
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-1 mb-4">
          <div className="flex items-center gap-2 w-[200px]">
            <Select
              prefix={t("module.time") + "："}
              value={sort}
              onChange={setSort}
              className="flex-none"
            >
              {sortOptions.map((opt) => (
                <Select.Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className="w-full md:w-auto">
            <Search
              value={keyword}
              onDebouncedChange={setKeyword}
              className="hidden md:flex"
              placeholder={t("action.search") + t("module.skill")}
            />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              size="large"
              className="w-full md:hidden el-input--main"
              placeholder={t("action.search") + t("module.skill")}
              prefix={<SearchOutlined />}
            />
          </div>
        </div>
      </div>
      <SkillList
        loading={skillsStore.mySkillLoading}
        keyword={keyword}
        list={skillsStore.mySkillList}
        sort={sort}
        type="my"
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${isSoftStyle ? "mt-2 " : "my-3"}`}
      />
    </div>
  );
}

export default MyList;
