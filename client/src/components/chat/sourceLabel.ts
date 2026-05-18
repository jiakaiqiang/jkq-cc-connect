import type { OrchestrationStep } from '@/types'

export interface ResolveMessageSourceLabelInput {
  sourceLabel?: string
  senderAgentName?: string
  targetAgentName?: string
  orchestrationStep?: OrchestrationStep
}

export function getMessageBubbleSourceProps(metadata: Record<string, unknown>): ResolveMessageSourceLabelInput {
  return {
    sourceLabel: metadata.sourceLabel as string | undefined,
    senderAgentName: metadata.senderAgentName as string | undefined,
    targetAgentName: metadata.targetAgentName as string | undefined,
    orchestrationStep: metadata.orchestrationStep as OrchestrationStep | undefined,
  }
}

export function resolveMessageSourceLabel(input: ResolveMessageSourceLabelInput) {
  if (input.sourceLabel) return input.sourceLabel
  if (input.senderAgentName && input.targetAgentName) {
    return `${input.senderAgentName} -> ${input.targetAgentName}`
  }
  return input.senderAgentName
}
