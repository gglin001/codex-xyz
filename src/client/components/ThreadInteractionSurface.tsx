import { Clock3, Send } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type {
	UserInputInteraction,
	UserInputInteractionAnswers,
	UserInputInteractionQuestion,
} from "../../server/domain.js";
import { cn, ui } from "../designSystem.js";

export type ThreadInteractionSurfaceProps = {
	interactions: UserInputInteraction[];
	submittingInteractionId: string | null;
	error: string | null;
	onAnswer: (
		interactionId: string,
		answers: UserInputInteractionAnswers,
	) => Promise<unknown>;
};

export function interactionRemainingSeconds(
	interaction: UserInputInteraction,
	now: number,
) {
	if (interaction.autoResolutionMs === null) {
		return null;
	}
	const deadline =
		Date.parse(interaction.requestedAt) + interaction.autoResolutionMs;
	return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function buildUserInputAnswers(
	questions: UserInputInteractionQuestion[],
	answers: UserInputInteractionAnswers,
	otherAnswers: Record<string, string>,
) {
	const next: UserInputInteractionAnswers = {};
	for (const question of questions) {
		const selected = answers[question.id] ?? [];
		const other = otherAnswers[question.id]?.trim();
		next[question.id] = other ? [...selected, other] : selected;
	}
	return next;
}

function QuestionField({
	question,
	values,
	otherValue,
	disabled,
	onValuesChange,
	onOtherValueChange,
}: {
	question: UserInputInteractionQuestion;
	values: string[];
	otherValue: string;
	disabled: boolean;
	onValuesChange: (values: string[]) => void;
	onOtherValueChange: (value: string) => void;
}) {
	if (!question.options?.length) {
		return (
			<input
				type={question.isSecret ? "password" : "text"}
				value={values[0] ?? ""}
				disabled={disabled}
				autoComplete="off"
				className={cn(
					ui.input,
					"h-9 w-full rounded-[8px] border border-border px-3",
				)}
				aria-label={question.header}
				onChange={(event) => onValuesChange([event.target.value])}
			/>
		);
	}

	return (
		<div className="grid gap-2">
			{question.options.map((option) => {
				const checked = values.includes(option.label);
				return (
					<label
						key={option.label}
						className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-[8px] border border-border bg-control px-3 py-2 text-[13px]"
					>
						<input
							type="checkbox"
							checked={checked}
							disabled={disabled}
							className="mt-0.5"
							onChange={() =>
								onValuesChange(
									checked
										? values.filter((value) => value !== option.label)
										: [...values, option.label],
								)
							}
						/>
						<span className="min-w-0">
							<span className="block font-medium text-fg">{option.label}</span>
							<span className="block text-[12px] text-muted">
								{option.description}
							</span>
						</span>
					</label>
				);
			})}
			{question.isOther ? (
				<input
					type={question.isSecret ? "password" : "text"}
					value={otherValue}
					disabled={disabled}
					autoComplete="off"
					placeholder="Other"
					className={cn(
						ui.input,
						"h-9 w-full rounded-[8px] border border-border px-3",
					)}
					aria-label={`${question.header} other answer`}
					onChange={(event) => onOtherValueChange(event.target.value)}
				/>
			) : null}
		</div>
	);
}

const InteractionCard = memo(function InteractionCard({
	interaction,
	submitting,
	error,
	onAnswer,
}: {
	interaction: UserInputInteraction;
	submitting: boolean;
	error: string | null;
	onAnswer: ThreadInteractionSurfaceProps["onAnswer"];
}) {
	const [answers, setAnswers] = useState<UserInputInteractionAnswers>({});
	const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (interaction.autoResolutionMs === null) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [interaction.autoResolutionMs]);

	const seconds = interactionRemainingSeconds(interaction, now);
	const submittedAnswers = useMemo(
		() => buildUserInputAnswers(interaction.questions, answers, otherAnswers),
		[answers, interaction.questions, otherAnswers],
	);
	const canSubmit = interaction.questions.every(
		(question) => (submittedAnswers[question.id]?.length ?? 0) > 0,
	);

	return (
		<form
			className="grid gap-4 rounded-[12px] border border-accent/35 bg-panel p-4 shadow-sm"
			onSubmit={(event) => {
				event.preventDefault();
				if (canSubmit && !submitting) {
					void onAnswer(interaction.id, submittedAnswers);
				}
			}}
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="text-[13px] font-semibold text-fg-strong">
						Input requested
					</div>
					<div className="mt-0.5 text-[12px] text-muted">
						Codex is waiting for your response.
					</div>
				</div>
				{seconds !== null ? (
					<div className="flex shrink-0 items-center gap-1 text-[12px] tabular-nums text-muted">
						<Clock3 size={13} aria-hidden="true" />
						<span>{seconds}s</span>
					</div>
				) : null}
			</div>
			{interaction.questions.map((question) => (
				<fieldset
					key={question.id}
					disabled={submitting}
					className="grid gap-2"
				>
					<legend className="text-[12px] font-semibold uppercase tracking-wide text-muted">
						{question.header}
					</legend>
					<p className="text-[14px] leading-5 text-fg">{question.question}</p>
					<QuestionField
						question={question}
						values={answers[question.id] ?? []}
						otherValue={otherAnswers[question.id] ?? ""}
						disabled={submitting}
						onValuesChange={(values) =>
							setAnswers((current) => ({ ...current, [question.id]: values }))
						}
						onOtherValueChange={(value) =>
							setOtherAnswers((current) => ({
								...current,
								[question.id]: value,
							}))
						}
					/>
				</fieldset>
			))}
			{error ? (
				<p role="alert" className="text-[12px] text-danger">
					{error}
				</p>
			) : null}
			<div className="flex justify-end">
				<button
					type="submit"
					disabled={!canSubmit || submitting}
					className="flex h-9 items-center gap-2 rounded-[8px] bg-accent px-3.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
				>
					<Send size={14} aria-hidden="true" />
					<span>{submitting ? "Sending" : "Send response"}</span>
				</button>
			</div>
		</form>
	);
});

export const ThreadInteractionSurface = memo(function ThreadInteractionSurface({
	interactions,
	submittingInteractionId,
	error,
	onAnswer,
}: ThreadInteractionSurfaceProps) {
	const pending = interactions.filter(
		(interaction) => interaction.status === "pending",
	);
	if (pending.length === 0) {
		return null;
	}
	return (
		<section
			className="shrink-0 px-3 pb-2 md:px-5"
			aria-label="Requested input"
		>
			<div className="mx-auto grid w-full max-w-[980px] gap-2">
				{pending.map((interaction) => (
					<InteractionCard
						key={interaction.id}
						interaction={interaction}
						submitting={submittingInteractionId === interaction.id}
						error={error}
						onAnswer={onAnswer}
					/>
				))}
			</div>
		</section>
	);
});
