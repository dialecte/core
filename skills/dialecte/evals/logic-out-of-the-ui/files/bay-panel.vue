<script setup lang="ts">
import { useProject } from '../project'

import { ref, onMounted } from 'vue'

const props = defineProps<{ voltageLevelId: string }>()
const rows = ref<{ id: string; name: string; equipmentCount: number }[]>([])
const showEmpty = ref(true)

onMounted(async () => {
	const doc = await useProject().document()
	const voltageLevel = await doc.query.getRecord({
		tagName: 'VoltageLevel',
		id: props.voltageLevelId,
	})
	const bays = await doc.query.getChildren(voltageLevel, { tagName: 'Bay' })
	for (const bay of bays) {
		const { name } = await doc.query.getAttributes(bay)
		const equipment = await doc.query.getChildren(bay, { tagName: 'ConductingEquipment' })
		rows.value.push({ id: bay.id, name: name ?? '', equipmentCount: equipment.length })
	}
})
</script>

<template>
	<label><input v-model="showEmpty" type="checkbox" /> show empty bays</label>
	<ul>
		<li v-for="row in rows.filter((r) => showEmpty || r.equipmentCount > 0)" :key="row.id">
			{{ row.name }} ({{ row.equipmentCount }})
		</li>
	</ul>
</template>
