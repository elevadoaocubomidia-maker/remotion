import {
	canMoveKeyframesWithoutCollisions,
	moveKeyframesInPropStatus,
} from '@remotion/studio-shared';
import React, {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';
import type {
	CanUpdateSequencePropStatusKeyframed,
	DragOverrideValue,
	SequencePropsSubscriptionKey,
	InteractivitySchema,
} from 'remotion';
import {Internals, useVideoConfig} from 'remotion';
import type {CodePosition} from '../../error-overlay/react-overlay/utils/get-source-map';
import {StudioServerConnectionCtx} from '../../helpers/client-id';
import {
	getEffectFieldsToShow,
	getFieldsToShow,
	type EffectSchemaFieldInfo,
	type SchemaFieldInfo,
} from '../../helpers/timeline-layout';
import {InlineAction} from '../InlineAction';
import {VERTICAL_SCROLLBAR_CLASSNAME} from '../Menu/is-menu-item';
import {InputDragger} from '../NewComposition/InputDragger';
import {callMoveKeyframes} from '../Timeline/call-move-keyframe';
import {parseKeyframeFieldFromNodePath} from '../Timeline/parse-keyframe-field-from-node-path';
import {TimelineEffectPropValue} from '../Timeline/TimelineEffectPropItem';
import {
	getTimelineSelectionFromNodePathInfo,
	useTimelineSelection,
	type TimelineSelection,
} from '../Timeline/TimelineSelection';
import {TimelineSequenceKeyframedValue} from '../Timeline/TimelineSequencePropItem';
import {
	InspectorDetailRow,
	InspectorMessage,
	InspectorSectionHeader,
} from './common';
import {
	clampInspectorKeyframeDisplayFrame,
	getInspectorKeyframeSourceFrame,
} from './keyframe-inspector-frame';
import {SequenceInspectorHeaderWithDivider} from './SequenceInspectorHeader';
import {
	detailsContainer,
	keyframeEditorLabel,
	keyframeEditorRow,
	keyframeEditorValue,
	sectionHeaderRow,
	sectionHeaderStart,
	sectionHeaderTitle,
	selectedContainer,
} from './styles';
import {useTrackForSelection} from './use-track-for-selection';

const backIcon: React.CSSProperties = {
	alignItems: 'center',
	display: 'flex',
	height: 12,
	justifyContent: 'center',
	width: 12,
};

const BackChevron: React.FC<{
	readonly color: string;
}> = ({color}) => {
	return (
		<svg viewBox="0 0 8 12" style={backIcon}>
			<path
				d="M6 1L2 6L6 11"
				fill="none"
				stroke={color}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
};

type KeyframeEditorDetails =
	| {
			readonly type: 'sequence';
			readonly field: SchemaFieldInfo;
			readonly fieldLabel: string;
			readonly fileName: string;
			readonly nodePath: SequencePropsSubscriptionKey;
			readonly propStatus: CanUpdateSequencePropStatusKeyframed;
			readonly schema: InteractivitySchema;
			readonly keyframeDisplayOffset: number;
			readonly sourceFrame: number;
	  }
	| {
			readonly type: 'effect';
			readonly effectIndex: number;
			readonly field: EffectSchemaFieldInfo;
			readonly fieldLabel: string;
			readonly fileName: string;
			readonly nodePath: SequencePropsSubscriptionKey;
			readonly propStatus: CanUpdateSequencePropStatusKeyframed;
			readonly schema: InteractivitySchema;
			readonly keyframeDisplayOffset: number;
			readonly sourceFrame: number;
			readonly validatedLocation: CodePosition;
	  };

const makeMovedKeyframedDragOverride = ({
	details,
	toFrame,
}: {
	readonly details: KeyframeEditorDetails;
	readonly toFrame: number;
}): DragOverrideValue | null => {
	if (
		!canMoveKeyframesWithoutCollisions({
			status: details.propStatus,
			moves: [{fromFrame: details.sourceFrame, toFrame}],
		})
	) {
		return null;
	}

	const movedStatus = moveKeyframesInPropStatus({
		status: details.propStatus,
		moves: [{fromFrame: details.sourceFrame, toFrame}],
	});

	if (movedStatus.status !== 'keyframed') {
		return null;
	}

	return {
		type: 'keyframed',
		status: movedStatus,
	};
};

export const KeyframeInspector: React.FC<{
	readonly selection: Extract<TimelineSelection, {type: 'keyframe'}>;
}> = ({selection}) => {
	const track = useTrackForSelection(selection);
	const videoConfig = useVideoConfig();
	const {propStatuses} = useContext(Internals.VisualModePropStatusesContext);
	const {
		clearDragOverrides,
		clearEffectDragOverrides,
		setDragOverrides,
		setEffectDragOverrides,
		setPropStatuses,
	} = useContext(Internals.VisualModeSettersContext);
	const {getDragOverrides, getEffectDragOverrides} = useContext(
		Internals.VisualModeDragOverridesContext,
	);
	const {previewServerState} = useContext(StudioServerConnectionCtx);
	const {selectItems} = useTimelineSelection();
	const [draftFrame, setDraftFrame] = useState(selection.frame);
	const parentSelection = useMemo(
		() => getTimelineSelectionFromNodePathInfo(selection.nodePathInfo),
		[selection.nodePathInfo],
	);

	useEffect(() => {
		setDraftFrame(selection.frame);
	}, [selection.frame]);

	const details = useMemo<KeyframeEditorDetails | null>(() => {
		if (!track || !track.sequence.controls) {
			return null;
		}

		const keyframeField = parseKeyframeFieldFromNodePath(
			selection.nodePathInfo.auxiliaryKeys,
		);
		if (keyframeField === null) {
			return null;
		}

		const nodePath = selection.nodePathInfo.sequenceSubscriptionKey;
		const {keyframeDisplayOffset} = track;
		const sourceFrame = selection.frame - keyframeDisplayOffset;

		if (keyframeField.type === 'sequence') {
			const sequenceFields = getFieldsToShow({
				schema: track.sequence.controls.schema,
				currentRuntimeValueDotNotation:
					track.sequence.controls.currentRuntimeValueDotNotation,
				getDragOverrides,
				propStatuses,
				nodePath,
			});
			const sequenceField =
				sequenceFields?.find(
					(candidate) => candidate.key === keyframeField.fieldKey,
				) ?? null;
			const sequencePropStatus =
				Internals.getPropStatusesCtx(propStatuses, nodePath)?.[
					keyframeField.fieldKey
				] ?? null;

			if (!sequenceField || sequencePropStatus?.status !== 'keyframed') {
				return null;
			}

			return {
				type: 'sequence',
				field: sequenceField,
				fieldLabel: sequenceField.description ?? sequenceField.key,
				fileName: nodePath.absolutePath,
				keyframeDisplayOffset,
				nodePath,
				propStatus: sequencePropStatus,
				schema: track.sequence.controls.schema,
				sourceFrame,
			};
		}

		const effect = track.sequence.effects[keyframeField.effectIndex];
		if (!effect) {
			return null;
		}

		const effectFields = getEffectFieldsToShow({
			effect,
			effectIndex: keyframeField.effectIndex,
			nodePath,
			propStatuses,
			getEffectDragOverrides,
		});
		const effectField =
			effectFields.find(
				(candidate) => candidate.key === keyframeField.fieldKey,
			) ?? null;
		const effectStatus = Internals.getEffectPropStatusesCtx({
			propStatuses,
			nodePath,
			effectIndex: keyframeField.effectIndex,
		});
		const effectPropStatus =
			effectStatus.type === 'can-update-effect'
				? (effectStatus.props[keyframeField.fieldKey] ?? null)
				: null;

		if (!effectField || effectPropStatus?.status !== 'keyframed') {
			return null;
		}

		return {
			type: 'effect',
			effectIndex: keyframeField.effectIndex,
			field: effectField,
			fieldLabel: effectField.description ?? effectField.key,
			fileName: nodePath.absolutePath,
			keyframeDisplayOffset,
			nodePath,
			propStatus: effectPropStatus,
			schema: effect.schema,
			sourceFrame,
			validatedLocation: {
				source: nodePath.absolutePath,
				line: 1,
				column: 0,
			},
		};
	}, [
		getDragOverrides,
		getEffectDragOverrides,
		propStatuses,
		selection,
		track,
	]);

	const clearFrameDragOverride = useCallback(
		(detailsToClear: KeyframeEditorDetails | null) => {
			if (detailsToClear === null) {
				return;
			}

			if (detailsToClear.type === 'sequence') {
				clearDragOverrides(detailsToClear.nodePath);
				return;
			}

			clearEffectDragOverrides(
				detailsToClear.nodePath,
				detailsToClear.effectIndex,
			);
		},
		[clearDragOverrides, clearEffectDragOverrides],
	);

	const onFrameChange = useCallback(
		(value: number) => {
			const displayFrame = clampInspectorKeyframeDisplayFrame({
				durationInFrames: videoConfig.durationInFrames,
				frame: value,
			});

			setDraftFrame(displayFrame);

			if (details === null) {
				return;
			}

			const toFrame = getInspectorKeyframeSourceFrame({
				displayFrame,
				keyframeDisplayOffset: details.keyframeDisplayOffset,
			});

			if (displayFrame === selection.frame || toFrame === details.sourceFrame) {
				clearFrameDragOverride(details);
				return;
			}

			const dragOverrideValue = makeMovedKeyframedDragOverride({
				details,
				toFrame,
			});

			if (dragOverrideValue === null) {
				clearFrameDragOverride(details);
				return;
			}

			if (details.type === 'sequence') {
				setDragOverrides(
					details.nodePath,
					details.field.key,
					dragOverrideValue,
				);
				return;
			}

			setEffectDragOverrides(
				details.nodePath,
				details.effectIndex,
				details.field.key,
				dragOverrideValue,
			);
		},
		[
			clearFrameDragOverride,
			details,
			selection.frame,
			setDragOverrides,
			setEffectDragOverrides,
			videoConfig.durationInFrames,
		],
	);

	const onFrameChangeEnd = useCallback(
		(value: number) => {
			if (details === null || previewServerState.type !== 'connected') {
				clearFrameDragOverride(details);
				setDraftFrame(selection.frame);
				return;
			}

			const displayFrame = clampInspectorKeyframeDisplayFrame({
				durationInFrames: videoConfig.durationInFrames,
				frame: value,
			});
			const toFrame = getInspectorKeyframeSourceFrame({
				displayFrame,
				keyframeDisplayOffset: details.keyframeDisplayOffset,
			});

			setDraftFrame(displayFrame);
			clearFrameDragOverride(details);

			if (displayFrame === selection.frame || toFrame === details.sourceFrame) {
				return;
			}

			if (makeMovedKeyframedDragOverride({details, toFrame}) === null) {
				setDraftFrame(selection.frame);
				return;
			}

			selectItems(
				[
					{
						...selection,
						frame: displayFrame,
					},
				],
				{reveal: true},
			);

			const move = {
				fileName: details.fileName,
				nodePath: details.nodePath,
				fieldKey: details.field.key,
				fromFrame: details.sourceFrame,
				toFrame,
				schema: details.schema,
			};

			callMoveKeyframes({
				sequenceKeyframes: details.type === 'sequence' ? [move] : [],
				effectKeyframes:
					details.type === 'effect'
						? [
								{
									...move,
									effectIndex: details.effectIndex,
								},
							]
						: [],
				setPropStatuses,
				clientId: previewServerState.clientId,
			}).catch(() => undefined);
		},
		[
			clearFrameDragOverride,
			details,
			previewServerState,
			selection,
			selectItems,
			setPropStatuses,
			videoConfig.durationInFrames,
		],
	);

	const onSelectParent = useCallback<
		React.MouseEventHandler<HTMLButtonElement>
	>(
		(event) => {
			event.stopPropagation();
			if (parentSelection === null) {
				return;
			}

			selectItems([parentSelection], {reveal: true});
		},
		[parentSelection, selectItems],
	);

	if (details === null || track === null) {
		return <InspectorMessage>Keyframe unavailable</InspectorMessage>;
	}

	return (
		<div style={selectedContainer} className={VERTICAL_SCROLLBAR_CLASSNAME}>
			<SequenceInspectorHeaderWithDivider track={track} />
			<InspectorSectionHeader>
				<div style={sectionHeaderRow}>
					<div style={sectionHeaderStart}>
						<InlineAction
							disabled={parentSelection === null}
							onClick={onSelectParent}
							title="Back to property"
							renderAction={(color) => <BackChevron color={color} />}
						/>
						<div style={sectionHeaderTitle}>{details.fieldLabel}</div>
					</div>
				</div>
			</InspectorSectionHeader>
			<div style={detailsContainer}>
				<InspectorDetailRow label="Frame">
					<InputDragger
						type="number"
						value={draftFrame}
						status="ok"
						onValueChange={onFrameChange}
						onValueChangeEnd={onFrameChangeEnd}
						onTextChange={() => undefined}
						min={0}
						max={Math.max(0, videoConfig.durationInFrames - 1)}
						step={1}
						formatter={(value) => String(Math.round(Number(value)))}
						rightAlign
						small
					/>
				</InspectorDetailRow>
				<div style={keyframeEditorRow}>
					<div style={keyframeEditorLabel}>{details.fieldLabel}</div>
					<div style={keyframeEditorValue}>
						{details.type === 'sequence' ? (
							<TimelineSequenceKeyframedValue
								field={details.field}
								fileName={details.fileName}
								nodePath={details.nodePath}
								schema={details.schema}
								propStatus={details.propStatus}
								sourceFrame={details.sourceFrame}
							/>
						) : (
							<TimelineEffectPropValue
								field={details.field}
								nodePath={details.nodePath}
								validatedLocation={details.validatedLocation}
								sourceFrame={details.sourceFrame}
							/>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};
