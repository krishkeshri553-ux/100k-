import revenue from "../../config/revenue.json" with { type: "json" };
import scoring from "../../config/scoring.json" with { type: "json" };
import calendar from "../../config/calendar.json" with { type: "json" };
import schedule from "../../config/schedule.json" with { type: "json" };
import salesNavigator from "../../config/sales_navigator.json" with { type: "json" };

export type RevenueConfig = typeof revenue;
export type ScoringConfig = typeof scoring;
export type CalendarConfig = typeof calendar;
export type ScheduleConfig = typeof schedule;
export type SalesNavigatorConfig = typeof salesNavigator;

export const config = { revenue, scoring, calendar, schedule, salesNavigator };
