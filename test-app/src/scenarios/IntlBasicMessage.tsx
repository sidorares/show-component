import { FormattedMessage } from 'react-intl';

/**
 * Scenario: Basic FormattedMessage
 *
 * Simple message with no interpolation values. The `<FormattedMessage>`
 * renders a text node inside a `<span>`, producing the fiber tree:
 *
 *   span → FormattedMessage → "Welcome to our application!"
 *
 * The chain transformer should collapse this into a single entry
 * labelled with the defaultMessage text.
 */
export function WelcomeBanner() {
  return (
    <div
      data-sc-test-id="intl-basic"
      data-sc-expect-owner="WelcomeBanner"
      data-sc-expect-file="scenarios/IntlBasicMessage.tsx"
      className="test-card"
    >
      <h3>Welcome Banner</h3>
      <span className="intl-text">
        <FormattedMessage
          id="welcome.banner"
          defaultMessage="Welcome to our application!"
          description="Main welcome banner heading"
        />
      </span>
    </div>
  );
}
