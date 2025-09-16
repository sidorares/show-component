# show-component

Quickly navigate to the line of code that is responsible for rendering a component

## Installation

```bash
npm install show-component
```

## Usage

```tsx
import { ShowComponent, useShowComponent } from 'show-component';

// Use the component wrapper
<ShowComponent>
  <YourComponent />
</ShowComponent>

// Or use the hook
const showComponent = useShowComponent();
```

## Features

- 🎯 Quickly navigate to component source code
- ⚡ Lightweight and fast
- 🔧 Easy integration with existing React projects
- 📦 TypeScript support included

## License

MIT
