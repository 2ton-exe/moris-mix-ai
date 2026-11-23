import { Star } from 'lucide-react'

type RatingField = {
  id: string
  name: string
  'aria-invalid': boolean
  'aria-describedby'?: string
  'data-form-focus-key': string
}

export function RecipeStarRating({ field, value, error, onChange }: {
  field: RatingField
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return <fieldset className="mm-recipe-star-rating" aria-describedby={field['aria-describedby']}>
    <legend>Rating <small aria-hidden="true">(optional)</small></legend>
    <div className="mm-recipe-star-rating__stars">
      {[1, 2, 3, 4, 5].map((rating) => {
        const id = field.id + '-' + rating
        return <label key={rating} htmlFor={id} data-filled={rating <= Number(value)}>
          <input {...field} id={id} className="visually-hidden" type="radio" value={rating}
            checked={value === String(rating)} onChange={() => onChange(String(rating))} />
          <Star size={21} aria-hidden="true" />
          <span className="visually-hidden">{rating} {rating === 1 ? 'star' : 'stars'}</span>
        </label>
      })}
    </div>
    <button className="mm-recipe-star-rating__clear" type="button" disabled={!value}
      aria-label="Clear rating" onClick={() => onChange('')}>{value ? 'Clear' : 'Unrated'}</button>
    {error && <p className="field-error" id={field.id + '-error'}>{error}</p>}
  </fieldset>
}
