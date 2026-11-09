/** The value of a command-line option: `--name <value>` or `--name=<value>`; none when the option is absent. */
export function optionValueOf(params: {
	argv: readonly string[]
	flag: string
}): string | undefined {
	const { argv, flag } = params
	const index = argv.findIndex((argument) => argument === flag || argument.startsWith(`${flag}=`))
	if (index === -1) return undefined
	const argument = argv[index]
	const value = argument === flag ? argv[index + 1] : argument.slice(flag.length + 1)
	if (value === undefined || value === '' || value.startsWith('-')) {
		throw new Error(`${flag} needs a value`)
	}
	return value
}
