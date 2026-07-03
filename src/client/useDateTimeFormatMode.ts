import { useEffect, useState } from "react";
import type { DateTimeFormatMode } from "./uiFormat.js";

export function useDateTimeFormatMode(): DateTimeFormatMode {
	const [dateTimeFormatMode, setDateTimeFormatMode] =
		useState<DateTimeFormatMode>("utc");

	useEffect(() => {
		setDateTimeFormatMode("local");
	}, []);

	return dateTimeFormatMode;
}
