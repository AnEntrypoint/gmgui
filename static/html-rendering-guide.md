# HTML Rendering Guide for GMGUI Agents

## Overview

GMGUI supports rich HTML rendering in agent responses. Agents should leverage HTML blocks to create visually compelling, data-driven responses that make information easier to understand.

## Core Principle

**All impactful information should be visualized in HTML.** Text-only responses should be minimal; visual representations are strongly preferred.

## How to Render HTML

Send a `sessionUpdate` with type `html_content`:

```json
{
  "sessionUpdate": "html_content",
  "content": {
    "html": "<div>Your HTML here</div>",
    "title": "Optional block title",
    "id": "optional-unique-id"
  }
}
```

## CSS Framework: RippleUI

The interface loads **RippleUI** CSS by default. Always use RippleUI classes first:

### Color Classes
- `bg-primary` - Primary background
- `bg-secondary` - Secondary background
- `text-primary` - Primary text
- `text-secondary` - Secondary text
- `border-color` - Border color
- `bg-success` - Success green
- `bg-danger` - Danger red
- `bg-warning` - Warning yellow
- `bg-info` - Info blue

### Spacing Classes
- `p-1` through `p-12` - Padding
- `m-1` through `m-12` - Margin
- `gap-1` through `gap-12` - Gap in flexbox/grid

### Sizing Classes
- `rounded-sm`, `rounded`, `rounded-lg`, `rounded-full`
- `w-full`, `h-full`

### Layout Classes
- `flex`, `flex-col`, `flex-row`
- `grid`, `grid-cols-2`, `grid-cols-3`, etc.

## Example Patterns

### 1. Data List

```html
<div class='bg-secondary border-color rounded-lg p-6'>
  <h3 class='text-primary mb-4'>Results</h3>
  <ul class='space-y-2'>
    <li class='flex justify-between'>
      <span>Item 1</span>
      <span class='text-secondary'>Value 1</span>
    </li>
    <li class='flex justify-between'>
      <span>Item 2</span>
      <span class='text-secondary'>Value 2</span>
    </li>
  </ul>
</div>
```

### 2. Metrics Dashboard

```html
<div class='bg-secondary rounded-lg p-6'>
  <h3 class='text-primary mb-6'>Metrics</h3>
  <div class='grid grid-cols-3 gap-4'>
    <div class='bg-primary rounded-lg p-4 text-center'>
      <div class='text-secondary text-sm'>Total</div>
      <div class='text-white text-3xl font-bold'>42</div>
    </div>
    <div class='bg-success rounded-lg p-4 text-center'>
      <div class='text-secondary text-sm'>Success</div>
      <div class='text-white text-3xl font-bold'>38</div>
    </div>
    <div class='bg-danger rounded-lg p-4 text-center'>
      <div class='text-secondary text-sm'>Failed</div>
      <div class='text-white text-3xl font-bold'>4</div>
    </div>
  </div>
</div>
```

### 3. Code Block

```html
<div class='bg-secondary rounded-lg p-6'>
  <h4 class='text-primary mb-4'>Code:</h4>
  <pre class='bg-primary rounded p-4 overflow-auto'>
    <code class='text-white text-sm'>function example() {
  return "Hello";
}</code>
  </pre>
</div>
```

### 4. Status Table

```html
<div class='bg-secondary rounded-lg p-6'>
  <h3 class='text-primary mb-4'>Status Report</h3>
  <table class='w-full'>
    <tr class='border-b border-color'>
      <th class='text-left p-2'>Component</th>
      <th class='text-left p-2'>Status</th>
    </tr>
    <tr class='border-b border-color'>
      <td class='p-2'>Database</td>
      <td class='p-2'><span class='bg-success text-white px-2 py-1 rounded'>Running</span></td>
    </tr>
    <tr class='border-b border-color'>
      <td class='p-2'>API</td>
      <td class='p-2'><span class='bg-success text-white px-2 py-1 rounded'>Running</span></td>
    </tr>
  </table>
</div>
```

## Fallback: Inline Styles

If RippleUI classes are unavailable, use inline styles:

```html
<div style='background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:24px;'>
  <h3 style='margin:0 0 16px 0; color:#1f2937;'>Title</h3>
  <p style='margin:0; color:#6b7280;'>Content here</p>
</div>
```

## When to Use HTML

✅ **Use HTML for:**
- Data lists and tables
- Metrics and statistics
- Code snippets
- Status reports
- Analysis results
- Hierarchical information
- Visual comparisons
- Progress indicators
- Charts and structured data

❌ **Plain text is OK for:**
- Brief acknowledgments
- Short conversations
- Error messages (unless detail is needed)
- Simple questions/answers

## Response Structure

Combine text and HTML for complete responses:

1. **Text explanation** - Send via normal agent_message_chunk
2. **HTML visualization** - Send via html_content (can be multiple)
3. **Images** - Send via image_content if appropriate

Example:
```
Agent sends: "Let me analyze the data..."
(agent_message_chunk with text)

Agent sends HTML block with analysis results
(html_content with visualization)

Agent sends: "Based on this, I recommend..."
(agent_message_chunk with conclusions)
```

## Image Display

For visual content, use:

```json
{
  "sessionUpdate": "image_content",
  "content": {
    "path": "/path/to/image.png",
    "title": "Image Title",
    "alt": "Alt text for accessibility"
  }
}
```

Supported formats: PNG, JPEG, GIF, WebP, SVG

## Best Practices

1. **Keep blocks focused** - One concept per HTML block
2. **Use color meaningfully** - Red for errors, green for success
3. **Include titles** - Every block should have a descriptive title
4. **Responsive design** - Use grid/flex for layout
5. **Accessibility** - Include alt text for images, semantic HTML
6. **Performance** - Keep HTML blocks under 10KB each
7. **Consistency** - Use the same styling patterns throughout

## Summary

Make responses visual, actionable, and beautiful. HTML rendering is the primary communication method—text is supplementary. Every important piece of information should be presented in a visually appealing way.
