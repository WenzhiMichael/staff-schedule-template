import type { Metadata } from "next";
import ManagerApp from "./ManagerApp";

export const metadata: Metadata = {
  title: "Staff Schedule 经理总表",
  description: "Staff Schedule 经理专用的员工时间汇总与名单管理",
};

export default function ManagerPage() {
  return <ManagerApp />;
}
