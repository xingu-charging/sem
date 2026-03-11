/**
 * @file OCPP 1.6 configuration key reference — complete list of standard configuration
 * keys as defined by the Open Charge Alliance specification, organized by feature profile.
 * @module @xingu-charging/sem
 * @license MIT
 *
 * Copyright (c) 2026 Xingu Charging
 * https://github.com/xingu-charging/sem
 */

export interface ConfigurationKeyInfo {
  key: string
  profile: 'Core' | 'LocalAuthListManagement' | 'Reservation' | 'SmartCharging' | 'FirmwareManagement' | 'RemoteTrigger'
  required: boolean
  readonly: boolean
  type: 'boolean' | 'integer' | 'string' | 'CSL'
  description: string
  example: string
  unit?: string
}

/**
 * Complete OCPP 1.6 Configuration Keys organized by profile
 */
export const OCPP_16_CONFIGURATION_KEYS: ConfigurationKeyInfo[] = [
  // Core Profile
  {
    key: 'AllowOfflineTxForUnknownId',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'boolean',
    description: 'If enabled, transactions may be started for unknown authorization identifiers when offline.',
    example: 'false'
  },
  {
    key: 'AuthorizationCacheEnabled',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'boolean',
    description: 'Enables the authorization cache.',
    example: 'false'
  },
  {
    key: 'AuthorizeRemoteTxRequests',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'boolean',
    description: 'Whether remote start transaction requests require authorization before starting.',
    example: 'true'
  },
  {
    key: 'BlinkRepeat',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'integer',
    description: 'Number of times to blink the charge point lighting when signaling.',
    example: '3'
  },
  {
    key: 'ClockAlignedDataInterval',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'integer',
    description: 'Interval in seconds for clock-aligned meter value sampling. Set to 0 to disable.',
    example: '0',
    unit: 'seconds'
  },
  {
    key: 'ConnectionTimeOut',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'integer',
    description: 'Interval in seconds from successful authorization until the EV must plug in the cable.',
    example: '30',
    unit: 'seconds'
  },
  {
    key: 'ConnectorPhaseRotation',
    profile: 'Core',
    required: true,
    readonly: true,
    type: 'CSL',
    description: 'Phase rotation for each connector. Format: ConnectorId.PhaseRotation.',
    example: '1.RST,2.RST'
  },
  {
    key: 'ConnectorPhaseRotationMaxLength',
    profile: 'Core',
    required: false,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of items in the ConnectorPhaseRotation configuration key.',
    example: '2'
  },
  {
    key: 'GetConfigurationMaxKeys',
    profile: 'Core',
    required: true,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of configuration keys that can be requested in a single GetConfiguration request.',
    example: '50'
  },
  {
    key: 'HeartbeatInterval',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'integer',
    description: 'Interval in seconds between heartbeat messages.',
    example: '300',
    unit: 'seconds'
  },
  {
    key: 'LightIntensity',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'integer',
    description: 'Percentage brightness of the charge point lighting (0-100).',
    example: '100',
    unit: '%'
  },
  {
    key: 'LocalAuthorizeOffline',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'boolean',
    description: 'Whether the charger can authorize transactions locally when offline.',
    example: 'true'
  },
  {
    key: 'LocalPreAuthorize',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'boolean',
    description: 'Whether to check the local authorization list/cache before sending an Authorize request.',
    example: 'false'
  },
  {
    key: 'MaxEnergyOnInvalidId',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'integer',
    description: 'Maximum energy in Wh that can be delivered when an identifier is invalid. Set to 0 for unlimited.',
    example: '0',
    unit: 'Wh'
  },
  {
    key: 'MeterValuesAlignedData',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'CSL',
    description: 'Comma-separated list of measurands to include in clock-aligned MeterValues.',
    example: 'Energy.Active.Import.Register,Power.Active.Import'
  },
  {
    key: 'MeterValuesAlignedDataMaxLength',
    profile: 'Core',
    required: false,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of measurands that can be configured in MeterValuesAlignedData.',
    example: '8'
  },
  {
    key: 'MeterValueSampleInterval',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'integer',
    description: 'Interval in seconds between sampled meter value transmissions during a transaction.',
    example: '15',
    unit: 'seconds'
  },
  {
    key: 'MeterValuesSampledData',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'CSL',
    description: 'Comma-separated list of measurands to include in sampled MeterValues during transactions.',
    example: 'Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage'
  },
  {
    key: 'MeterValuesSampledDataMaxLength',
    profile: 'Core',
    required: false,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of measurands that can be configured in MeterValuesSampledData.',
    example: '8'
  },
  {
    key: 'MinimumStatusDuration',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'integer',
    description: 'Minimum duration in seconds that a status must persist before sending StatusNotification.',
    example: '0',
    unit: 'seconds'
  },
  {
    key: 'NumberOfConnectors',
    profile: 'Core',
    required: true,
    readonly: true,
    type: 'integer',
    description: 'Number of physical connectors on this charge point.',
    example: '2'
  },
  {
    key: 'ResetRetries',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'integer',
    description: 'Number of times to retry a reset command if the initial reset fails.',
    example: '3'
  },
  {
    key: 'StopTransactionOnEVSideDisconnect',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'boolean',
    description: 'Whether to automatically stop a transaction when the EV disconnects the cable.',
    example: 'true'
  },
  {
    key: 'StopTransactionOnInvalidId',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'boolean',
    description: 'Whether to stop a transaction when the authorization identifier becomes invalid.',
    example: 'true'
  },
  {
    key: 'StopTxnAlignedData',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'CSL',
    description: 'Comma-separated list of measurands to include in the StopTransaction message for clock-aligned data.',
    example: ''
  },
  {
    key: 'StopTxnAlignedDataMaxLength',
    profile: 'Core',
    required: false,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of measurands that can be configured in StopTxnAlignedData.',
    example: '8'
  },
  {
    key: 'StopTxnSampledData',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'CSL',
    description: 'Comma-separated list of measurands to include in the StopTransaction message for sampled data.',
    example: 'Energy.Active.Import.Register,Power.Active.Import'
  },
  {
    key: 'StopTxnSampledDataMaxLength',
    profile: 'Core',
    required: false,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of measurands that can be configured in StopTxnSampledData.',
    example: '8'
  },
  {
    key: 'SupportedFeatureProfiles',
    profile: 'Core',
    required: true,
    readonly: true,
    type: 'CSL',
    description: 'Comma-separated list of supported OCPP feature profiles.',
    example: 'Core,FirmwareManagement,SmartCharging,RemoteTrigger'
  },
  {
    key: 'SupportedFeatureProfilesMaxLength',
    profile: 'Core',
    required: false,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of feature profiles that can be listed in SupportedFeatureProfiles.',
    example: '6'
  },
  {
    key: 'TransactionMessageAttempts',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'integer',
    description: 'Number of times to attempt sending a StartTransaction or StopTransaction message.',
    example: '3'
  },
  {
    key: 'TransactionMessageRetryInterval',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'integer',
    description: 'Interval in seconds between retry attempts for transaction messages.',
    example: '60',
    unit: 'seconds'
  },
  {
    key: 'UnlockConnectorOnEVSideDisconnect',
    profile: 'Core',
    required: true,
    readonly: false,
    type: 'boolean',
    description: 'Whether to automatically unlock the connector when the EV disconnects the cable.',
    example: 'true'
  },
  {
    key: 'WebSocketPingInterval',
    profile: 'Core',
    required: false,
    readonly: false,
    type: 'integer',
    description: 'Interval in seconds between WebSocket ping frames.',
    example: '60',
    unit: 'seconds'
  },

  // Local Auth List Management Profile
  {
    key: 'LocalAuthListEnabled',
    profile: 'LocalAuthListManagement',
    required: true,
    readonly: false,
    type: 'boolean',
    description: 'Whether the local authorization list is enabled.',
    example: 'true'
  },
  {
    key: 'LocalAuthListMaxLength',
    profile: 'LocalAuthListManagement',
    required: true,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of identifiers that can be stored in the local authorization list.',
    example: '1000'
  },
  {
    key: 'SendLocalListMaxLength',
    profile: 'LocalAuthListManagement',
    required: true,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of identifiers that can be sent in a single SendLocalList request.',
    example: '100'
  },

  // Reservation Profile
  {
    key: 'ReserveConnectorZeroSupported',
    profile: 'Reservation',
    required: false,
    readonly: true,
    type: 'boolean',
    description: 'Whether reserving connector 0 (the whole charge point) is supported.',
    example: 'false'
  },

  // Smart Charging Profile
  {
    key: 'ChargeProfileMaxStackLevel',
    profile: 'SmartCharging',
    required: true,
    readonly: true,
    type: 'integer',
    description: 'Maximum stack level supported for charging profiles.',
    example: '3'
  },
  {
    key: 'ChargingScheduleAllowedChargingRateUnit',
    profile: 'SmartCharging',
    required: true,
    readonly: true,
    type: 'CSL',
    description: 'Allowed units for charging rate in charging schedules. Values: A (Amperes), W (Watts).',
    example: 'A,W'
  },
  {
    key: 'ChargingScheduleMaxPeriods',
    profile: 'SmartCharging',
    required: true,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of periods that can be defined in a single charging schedule.',
    example: '24'
  },
  {
    key: 'ConnectorSwitch3to1PhaseSupported',
    profile: 'SmartCharging',
    required: false,
    readonly: true,
    type: 'boolean',
    description: 'Whether the charger can switch between 3-phase and 1-phase charging.',
    example: 'false'
  },
  {
    key: 'MaxChargingProfilesInstalled',
    profile: 'SmartCharging',
    required: true,
    readonly: true,
    type: 'integer',
    description: 'Maximum number of charging profiles that can be installed on the charge point simultaneously.',
    example: '10'
  }
]

/**
 * Get configuration key info by key name
 */
export function getConfigurationKeyInfo(key: string): ConfigurationKeyInfo | undefined {
  return OCPP_16_CONFIGURATION_KEYS.find(k => k.key === key)
}

/**
 * Get all configuration keys for a specific profile
 */
export function getConfigurationKeysByProfile(profile: ConfigurationKeyInfo['profile']): ConfigurationKeyInfo[] {
  return OCPP_16_CONFIGURATION_KEYS.filter(k => k.profile === profile)
}

/**
 * Create a map of key name to key info for quick lookup
 */
export const CONFIGURATION_KEY_MAP: Record<string, ConfigurationKeyInfo> = Object.fromEntries(
  OCPP_16_CONFIGURATION_KEYS.map(k => [k.key, k])
)
