import {padArray} from '../../utils/array-utils';

const DEFAULT_TRANSITION_SETTINGS = {
  interpolation: {
    duration: 0,
    easing: t => t
  },
  spring: {
    stiffness: 0.05,
    damping: 0.5
  }
};

export function normalizeTransitionSettings(userSettings, layerSettings) {
  if (!userSettings) {
    return null;
  }
  if (Number.isFinite(userSettings)) {
    userSettings = {duration: userSettings};
  }
  userSettings.type = userSettings.type || 'interpolation';
  return Object.assign(
    {},
    DEFAULT_TRANSITION_SETTINGS[userSettings.type],
    layerSettings,
    userSettings
  );
}

// NOTE: NOT COPYING OVER OFFSET OR STRIDE HERE BECAUSE:
// (1) WE DON'T SUPPORT INTERLEAVED BUFFERS FOR TRANSITIONS
// (2) BUFFERS WITH OFFSETS ALWAYS CONTAIN VALUES OF THE SAME SIZE
// (3) THE OPERATIONS IN THE SHADER ARE PER-COMPONENT (addition and scaling)
export function getSourceBufferAttribute(gl, attribute) {
  // The Attribute we pass to Transform as a sourceBuffer must have {divisor: 0}
  // so we create a copy of the attribute (with divisor=0) to use when running
  // transform feedback
  const buffer = attribute.getBuffer();
  if (buffer) {
    return [
      attribute.getBuffer(),
      {
        divisor: 0,
        size: attribute.size,
        normalized: attribute.settings.normalized
      }
    ];
  }
  // constant
  // don't pass normalized here because the `value` from a normalized attribute is
  // already normalized
  return attribute.value;
}

export function getAttributeTypeFromSize(size) {
  switch (size) {
    case 1:
      return 'float';
    case 2:
      return 'vec2';
    case 3:
      return 'vec3';
    case 4:
      return 'vec4';
    default:
      throw new Error(`No defined attribute type for size "${size}"`);
  }
}

export function cycleBuffers(buffers) {
  buffers.push(buffers.shift());
}

export function getAttributeBufferLength(attribute, numInstances) {
  const {doublePrecision, settings, value, size} = attribute;
  const multiplier = doublePrecision ? 2 : 1;
  return (settings.noAlloc ? value.length : numInstances * size) * multiplier;
}

// This helper is used when transitioning attributes from a set of values in one buffer layout
// to a set of values in a different buffer layout. (Buffer layouts are used when attribute values
// within a buffer should be grouped for drawElements, like the Polygon layer.) For example, a
// buffer layout of [3, 4] might have data [A1, A2, A3, B1, B2, B3, B4]. If it needs to transition
// to a buffer layout of [4, 2], it should produce a buffer, using the transition setting's `enter`
// function, that looks like this: [A1, A2, A3, A4 (user `enter` fn), B1, B2, 0]. Note: the final
// 0 in this buffer is because we never shrink buffers, only grow them, for performance reasons.
export function padBuffer({
  buffer,
  numInstances,
  attribute,
  fromLength,
  fromStartIndices,
  getData = x => x
}) {
  // TODO: move the precisionMultiplier logic to the attribute when retrieving
  // its `size` and `elementOffset`?
  const precisionMultiplier = attribute.doublePrecision ? 2 : 1;
  const size = attribute.size * precisionMultiplier;
  const offset = attribute.elementOffset * precisionMultiplier;
  const toStartIndices = attribute.startIndices;
  const hasStartIndices = fromStartIndices && toStartIndices;
  const toLength = getAttributeBufferLength(attribute, numInstances);
  const isConstant = attribute.state.constant;

  // check if buffer needs to be padded
  if (!hasStartIndices && fromLength >= toLength) {
    return;
  }

  const toData = isConstant ? attribute.value : attribute.getBuffer().getData({});
  if (attribute.settings.normalized) {
    const getter = getData;
    getData = (value, chunk) => attribute._normalizeConstant(getter(value, chunk));
  }

  const getMissingData = isConstant
    ? (i, chunk) => getData(toData, chunk)
    : (i, chunk) => getData(toData.subarray(i, i + size), chunk);

  const source = buffer.getData({length: fromLength});
  const data = new Float32Array(toLength);
  padArray({
    source,
    target: data,
    sourceStartIndices: fromStartIndices,
    targetStartIndices: toStartIndices,
    offset,
    size,
    getData: getMissingData
  });

  buffer.setData({data});
}
