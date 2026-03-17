---
# https://vitepress.dev/reference/default-theme-home-page
layout: home
description: Dialecte is a type-safe SDK for building XML-based DSLs. Point it at an XSD schema and get a fully-typed Document API with IndexedDB persistence and streaming XML import/export.

hero:
  name: Dialecte
  text: Speak XML your way.
  tagline: A type-safe SDK for building XML-based DSLs — define the XSD schema, Dialecte does the rest.
  image:
    src: /logo-reversed.svg
    alt: Dialecte
  actions:
    - theme: brand
      text: Get Started →
      link: /guide/introduction/getting-started
    - theme: alt
      text: Why Dialecte?
      link: /guide/introduction/what-is-dialecte
features:
  - icon: �
    title: Document Model
    details: A clear separation of concerns — Document for lifecycle, Query for reads, Transaction for writes. No hidden state, no surprises.
  - icon: 🛡️
    title: Type-Safe by Design
    details: Your schema drives the types. The compiler catches invalid children and attributes before your code ever runs.
  - icon: 🧩
    title: Dialecte-Agnostic
    details: Core stays domain-free. Plug in any XML dialect — SCL, CIM, or your own — through isolated dialecte packages.
---
