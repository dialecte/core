# Test Fixtures

Auto-generated test fixtures for comprehensive SDK testing.

## Structure - Rule of 3

**121 elements** following the "Rule of 3" pattern:

- Root → A, B, C (3 branches)
- Each element → \_1, \_2, \_3 children (3 siblings)
- 3 levels deep from each branch (depth = 3)

### Element Naming Pattern

Each level adds one letter:

```
A             → AA_1, AA_2, AA_3
AA_1          → AAA_1, AAA_2, AAA_3
AAA_1         → AAAA_1, AAAA_2, AAAA_3
```

Same pattern for B and C branches:

```
B → BB_1, BB_2, BB_3 → BBB_1, BBB_2, BBB_3 → BBBB_1, BBBB_2, BBBB_3
C → CC_1, CC_2, CC_3 → CCC_1, CCC_2, CCC_3 → CCCC_1, CCCC_2, CCCC_3
```

**Element count**: 1 (Root) + 3 (branches) + 9 + 27 + 81 = **121 elements**

### Branch D - xsi:type

Same names, occurrences and namespaces, one level less deep, each element a case of `xsi:type`:

```
D → DD_1 (abstract type tDD_1: variants tDD_1A, tDD_1B, ext:tDD_1A, ext:tDD_1C)
    DD_2 (concrete type tDD_2, variant tDD_2A) → DDD_2 (anyType), ext:DDD_3 (no attribute)
    ext:DD_3 (type ext:tDD_3, blocks extension: ext:tDD_3A refused)
tDD_1A → DDD_1 (held only through this variant)
```

Variant-only attributes take the next letters: `dDD_1` (required, tDD_1A), `eDD_1` (default, tDD_1B), `fDD_1` (fixed
`mm`, tDD_1B), `ext:dDD_1` (ext:tDD_1A, qualified). Two leaves break the a/b/c rule on purpose: `DDD_2` has no type
(anyType: any attribute, any child) and `ext:DDD_3` has no attribute at all.

## Attributes

Each element has **3 attributes** prefixed with lowercase letters:

```typescript
// Element BBB_1:
aBBB_1 // required, element's namespace
bBBB_1 // optional, element's namespace
cBBB_1 // optional, ALWAYS ext namespace (qualified)
```

**Rules**:

- `a{ElementName}`: required attribute
- `b{ElementName}`, `c{ElementName}`: optional attributes
- `c` attribute always uses ext namespace regardless of element namespace

## Namespaces

**Elements**:

1. All `_3` suffix elements: ext namespace (A_3, AA_3, BBB_3, etc.)
2. Everything else: default namespace

**Attributes**:

- `a` and `b` attributes: match element's namespace
- `c` attribute: always ext namespace (qualified)

## Validation Rules

**Element occurrence**:

- `_1` elements: required (minOccurrence=1)
- `_2` elements: maxOccurrence=2
- `_3` elements: maxOccurrence=3

## XML Examples

```xml
<!-- Default namespace element with mixed attributes -->
<Root xmlns="http://dialecte.dev/XML/DEV"
      xmlns:ext="http://dialecte.dev/XML/DEV-EXT">
  <A aA="value"
     bA="value"
     ext:cA="qualified value"/>
</Root>

<!-- Ext namespace element (_3 suffix) -->
<Root xmlns="http://dialecte.dev/XML/DEV"
      xmlns:ext="http://dialecte.dev/XML/DEV-EXT">
  <ext:A_3 ext:aA_3="value"
           ext:bA_3="value"
           ext:cA_3="also qualified"/>
</Root>
```

## Generation

Run `npm run fixtures:generate` to regenerate types/constants from `generated/definition.ts`.
