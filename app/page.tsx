import type { Metadata } from "next";
import ScheduleApp from "./ScheduleApp";

export const metadata: Metadata = {
  title: "Staff Schedule 员工班表",
  description: "Staff Schedule 员工个人可上班时间与正式班表",
};

export default function Home() {
  return <ScheduleApp />;
}
