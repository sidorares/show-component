import { FormattedMessage } from 'react-intl';

/**
 * Scenario: FormattedMessage with ICU plural syntax
 *
 * Demonstrates a more complex ICU message with `{count, plural, ...}`.
 * The transformer should still detect and label it correctly.
 */
export function NotificationBadge({ count }: { count: number }) {
  return (
    <span
      data-sc-test-id="intl-plural"
      data-sc-expect-owner="NotificationBadge"
      data-sc-expect-file="scenarios/IntlPluralMessage.tsx"
      className="test-badge"
    >
      <FormattedMessage
        id="notification.badge" defaultMessage="You have {count, plural, one {# new notification} other {# new notifications}}"
        description="Notification count badge"
        values={{ count }}
      />
    </span>
  );
}
