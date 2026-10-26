import type { AvatarExpressionId, AvatarShapeId } from "@openbot/brand/agent-avatar";
import type { AppTextKey } from "@openbot/i18n";

/** The name of each avatar shape, for the picker buttons. */
export const AVATAR_SHAPE_LABEL = {
  circle: "agent.avatar.shape.circle",
  pebble: "agent.avatar.shape.pebble",
  squircle: "agent.avatar.shape.squircle",
  capsule: "agent.avatar.shape.capsule",
  onigiri: "agent.avatar.shape.onigiri",
  hex: "agent.avatar.shape.hex",
  cloud: "agent.avatar.shape.cloud",
  egg: "agent.avatar.shape.egg",
} as const satisfies Record<AvatarShapeId, AppTextKey>;

/** The name of each resting expression, for the picker buttons. */
export const AVATAR_EXPRESSION_LABEL = {
  neutral: "agent.avatar.expression.neutral",
  attentive: "agent.avatar.expression.attentive",
  happy: "agent.avatar.expression.happy",
  excited: "agent.avatar.expression.excited",
  laugh: "agent.avatar.expression.laugh",
  curious: "agent.avatar.expression.curious",
  proud: "agent.avatar.expression.proud",
  shy: "agent.avatar.expression.shy",
} as const satisfies Record<AvatarExpressionId, AppTextKey>;
