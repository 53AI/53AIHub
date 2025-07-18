<script setup lang="ts">
import { ref, reactive, getCurrentInstance, computed, onMounted } from 'vue'
import { useEnterpriseStore, useUserStore } from '@/stores'
import { generateInputRules } from '@/utils/form-rule'
import { templateStyleApi, TEMPLATE_STYLE_TYPE_WEBSITE, TEMPLATE_STYLE_TYPE_SOFTWARE, TEMPLATE_STYLE_TYPE_LABEL_MAP, TEMPLATE_STYLE_TYPE_DEMO_MAP } from '@/api/modules/template-style'

const { proxy: _this } = getCurrentInstance()

const enterprise_store = useEnterpriseStore()
const user_store = useUserStore()

const form_ref = ref()
const loading = ref(true)
const submitting = ref(false)
const enterprise_info = computed(() => enterprise_store.info)
const enterprise_logo = computed(() => enterprise_store.info.logo || '')
const enterprise_ico = computed(() => enterprise_store.info.ico || enterprise_logo.value)
const enterprise_name = computed(() => enterprise_store.info.display_name || '')

const form = reactive({
	style_type: TEMPLATE_STYLE_TYPE_WEBSITE,
	theme_color: '#2563eb',
	text_color: '#333333',
	nav_bg_color: '#ffffff',
	nav_text_color: '#333333',
	page_footer_bg_color: '#18191f',
	page_footer_text_color: '#f2f2f2',
})
const rules = reactive({
})
const handleSave = async () => {
	const valid = await form_ref.value.validate()
	if (!valid) return
	submitting.value = true
	await templateStyleApi.saveTemplateStyle({
		...form
	}).finally(() => {
		submitting.value = false
	})
	ElMessage.success(window.$t('action_save_success'))
	fetchTemplateStyleData()
}
const fetchTemplateStyleData = async () => {
	loading.value = true
	const data = await templateStyleApi.getTemplateStyle().finally(() => {
		loading.value = false
	})
	form.style_type = data.style_type || TEMPLATE_STYLE_TYPE_WEBSITE
	if (![TEMPLATE_STYLE_TYPE_WEBSITE, TEMPLATE_STYLE_TYPE_SOFTWARE].includes(form.style_type)) form.style_type = TEMPLATE_STYLE_TYPE_WEBSITE
	form.theme_color = data.theme_color || '#3664EF'
	form.text_color = data.text_color || '#333333'
	form.nav_bg_color = data.nav_bg_color || '#ffffff'
	form.nav_text_color = data.nav_text_color || '#333333'
	form.page_footer_bg_color = data.page_footer_bg_color || '#18191F'
	form.page_footer_text_color = data.page_footer_text_color || '#F2F2F2'
}

onMounted(() => {
	fetchTemplateStyleData()
})
</script>

<template>
	<Layout class="px-[60px] py-8">
		<Header :title="$t('module.template_style')"></Header>
		<div class="mt-5 flex-1 flex flex-col gap-4 bg-white py-6 px-8 box-border" v-loading="loading">
			<h4 class="text-[#1D1E1F] font-semibold">{{ $t('action_preview') }}</h4>
			<div class="w-full relative shadow-md overflow-auto">
				<div class="w-full relative flex items-center justify-between bg-[#F0F0F0] min-w-[720px]">
					<div class="w-[340px] h-[46px]"
						:style="{ 'background': `url(${$getRealPath({ url: '/images/browser_navigation_bar.png' })})`, 'background-size': '1025px 46px' }" />
					<div class="w-[280px] h-[46px]"
						:style="{ 'background': `url(${$getRealPath({ url: '/images/browser_navigation_bar.png' })})`, 'background-size': '1025px 46px', 'background-position': 'right top' }" />
				</div>
				<div class="absolute top-0 left-[96px] h-[46px] overflow-hidden flex items-center gap-2">
					<img :src="enterprise_ico" class="w-[14px] object-cover" />
					<div class="text-[#1D1E1F] text-sm max-w-[8em] truncate">{{ enterprise_name }}</div>
				</div>
				<div
					class="w-full min-w-[720px] h-[79px] px-[32px] box-border flex items-center justify-between rounded"
					:style="{ backgroundColor: form.nav_bg_color }">
					<div class="flex items-center gap-3">
						<img :src="enterprise_logo" class="w-[44px] object-cover" />
						<div class="text-[24px] font-semibold max-w-[12em] truncate" :style="{ color: form.nav_text_color }">{{
							enterprise_name }}</div>
					</div>
					<div class="flex items-center gap-2">
						<div class="text-[#fff] text-sm w-[76px] h-[38px] leading-[38px] text-center rounded-md overflow-hidden"
							:style="{ backgroundColor: form.theme_color }">
							{{ $t('action_login') }}
						</div>
					</div>
				</div>
			</div>
			<ElDivider />
			<ElForm ref="form_ref" class="flex-1 max-h-[calc(100vh-378px)] overflow-auto" :model="form" :rules="rules"
				label-position="top">
				<ElFormItem :label="$t('template_style.website_style')">
					<ul class="flex flex-wrap gap-4">
						<li v-for="value in [TEMPLATE_STYLE_TYPE_WEBSITE, TEMPLATE_STYLE_TYPE_SOFTWARE]" :key="value"
							class="w-[172px] p-1.5 bg-[#F5F5F5] flex flex-col cursor-pointer items-center gap-2 border rounded box-border overflow-hidden text-sm hover:border-[#3664EF] hover:text-[#3664EF]"
							:class="[form.style_type === value ? 'border-[#3664EF] text-[#3664EF]' : 'text-[#4F5052]']"
							@click.stop="form.style_type = value">
							<div class="text-sm p-1.5">{{ $t(TEMPLATE_STYLE_TYPE_LABEL_MAP.get(value)) }}</div>
							<ElImage class="w-full" :src="$getRealPath({ url: TEMPLATE_STYLE_TYPE_DEMO_MAP.get(value) })"
								fit="contain" />
						</li>
					</ul>
				</ElFormItem>
				<ElFormItem :label="$t('template_style.theme_color')">
					<ul class="flex items-center flex-wrap gap-7 text-[#4F5052] text-sm">
						<li class="flex items-center gap-2">
							<el-color-picker v-model="form.theme_color" />
							<span>{{ $t('template_style.theme_color_v2') }}</span>
						</li>
						<li class="flex items-center gap-2">
							<el-color-picker v-model="form.text_color" />
							<span>{{ $t('template_style.text_color') }}</span>
						</li>
						<li class="flex items-center gap-2">
							<el-color-picker v-model="form.nav_bg_color" />
							<span>{{ $t('template_style.nav_bg_color') }}</span>
						</li>
						<li class="flex items-center gap-2">
							<el-color-picker v-model="form.nav_text_color" />
							<span>{{ $t('template_style.nav_text_color') }}</span>
						</li>
						<li class="flex items-center gap-2">
							<el-color-picker v-model="form.page_footer_bg_color" />
							<span>{{ $t('template_style.page_footer_bg_color') }}</span>
						</li>
						<li class="flex items-center gap-2">
							<el-color-picker v-model="form.page_footer_text_color" />
							<span>{{ $t('template_style.page_footer_text_color') }}</span>
						</li>
					</ul>
				</ElFormItem>
				<div class="w-full h-8"></div>
			</ElForm>
			<ElDivider class="!my-3" />
			<ElButton class="h-[36px] w-[96px]" type="primary" size="large" :loading="submitting" @click="handleSave">{{
				$t('action_save') }}
			</ElButton>
		</div>
	</Layout>
</template>

<style scoped>
</style>
