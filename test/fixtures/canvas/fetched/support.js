// Stand-in for the Design type's runtime, written from its documented format so fixtures render without claude.ai (plans/v1/research/06-project-format.md).
(() => {
  const HOLE = /\{\{\s*([\w.$]+)\s*\}\}/g
  const WHOLE_HOLE = /^\s*\{\{\s*([\w.$]+)\s*\}\}\s*$/

  class DCLogic {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }

    renderVals() {
      return {}
    }
  }
  window.DCLogic = DCLogic

  function lookup(scope, path) {
    return path.split('.').reduce((value, key) => value?.[key], scope)
  }

  function fillHoles(text, scope) {
    return text.replace(HOLE, (_hole, path) => String(lookup(scope, path) ?? ''))
  }

  function holeValue(text, scope) {
    const match = WHOLE_HOLE.exec(text ?? '')
    return match ? lookup(scope, match[1]) : undefined
  }

  function componentVals(root) {
    const props = JSON.parse(root.getAttribute('data-props') ?? '{}')
    const script = root.querySelector('script[data-dc-script]')
    if (!script) return props
    const Component = new Function('DCLogic', `${script.textContent}\nreturn Component`)(DCLogic)
    return new Component(props).renderVals()
  }

  function renderChildren(parent, scope) {
    const fragment = document.createDocumentFragment()
    for (const child of [...parent.childNodes]) fragment.append(...renderNode(child, scope))
    return fragment
  }

  function renderNode(node, scope) {
    if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(fillHoles(node.data, scope))]
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    switch (node.localName) {
      case 'script':
        return []
      case 'helmet':
        return [node]
      case 'sc-for':
        return renderLoop(node, scope)
      case 'sc-if':
        return holeValue(node.getAttribute('when'), scope) ? [renderChildren(node, scope)] : []
      case 'dc-import':
        return [renderImport(node, scope)]
      default:
        return [renderElement(node, scope)]
    }
  }

  function renderElement(source, scope) {
    const element = document.createElementNS(source.namespaceURI, source.localName)
    for (const { name, value } of source.attributes) element.setAttribute(name, fillHoles(value, scope))
    element.append(renderChildren(source, scope))
    return element
  }

  function renderLoop(loop, scope) {
    const name = loop.getAttribute('as')
    const items = holeValue(loop.getAttribute('list'), scope) ?? []
    return items.map((item) => renderChildren(loop, { ...scope, [name]: item }))
  }

  function renderImport(source, scope) {
    const host = renderElement(source, scope)
    mountImport(host, new URL(source.getAttribute('src'), document.baseURI))
    return host
  }

  async function mountImport(host, url) {
    const response = await fetch(url)
    const imported = new DOMParser().parseFromString(await response.text(), 'text/html')
    const root = imported.querySelector('x-dc')
    host.append(renderChildren(root, componentVals(root)))
  }

  function mount(root) {
    root.replaceChildren(renderChildren(root, componentVals(root)))
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const root of document.querySelectorAll('x-dc')) mount(root)
  })
})()
